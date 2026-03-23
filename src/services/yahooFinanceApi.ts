import * as https from 'https';
import { StockItem, MarketIndex, WatchlistEntry, PriceDirection } from '../models/types';

const TIMEOUT_MS = 10000;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)';

// Cache: bare 6-digit code -> Yahoo symbol (e.g. '005930' -> '005930.KS')
const symbolCache = new Map<string, string>();

const INDEX_MAP: Record<string, string> = {
	'KOSPI': '^KS11',
	'KOSDAQ': '^KQ11',
};

const INDEX_NAMES: Record<string, string> = {
	'^KS11': '코스피',
	'^KQ11': '코스닥',
};

function httpGet(url: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const req = https.get(url, {
			timeout: TIMEOUT_MS,
			headers: { 'User-Agent': USER_AGENT },
		}, (res) => {
			if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
				reject(new Error(`HTTP ${res.statusCode}`));
				res.resume();
				return;
			}
			const chunks: Buffer[] = [];
			res.on('data', (chunk: Buffer) => chunks.push(chunk));
			res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
			res.on('error', reject);
		});
		req.on('error', reject);
		req.on('timeout', () => {
			req.destroy();
			reject(new Error('Request timed out'));
		});
	});
}

function deriveDirection(change: number): PriceDirection {
	if (change > 0) { return PriceDirection.RISING; }
	if (change < 0) { return PriceDirection.FALLING; }
	return PriceDirection.FLAT;
}

function formatKSTTime(unixSeconds: number): string {
	const date = new Date(unixSeconds * 1000);
	return date.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

function mapMarketStatus(state: string | undefined): string {
	if (state === 'REGULAR') { return 'OPEN'; }
	return 'CLOSE';
}

function stripSuffix(symbol: string): string {
	return symbol.replace(/\.(KS|KQ)$/i, '');
}

// ── Symbol Resolution ──────────────────────────────────────────────

async function probeSymbol(symbol: string): Promise<boolean> {
	try {
		const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
		const body = await httpGet(url);
		const json = JSON.parse(body);
		return json.chart?.result?.length > 0;
	} catch {
		return false;
	}
}

async function resolveSymbol(code: string): Promise<string> {
	const cached = symbolCache.get(code);
	if (cached) { return cached; }

	const ks = `${code}.KS`;
	if (await probeSymbol(ks)) {
		symbolCache.set(code, ks);
		return ks;
	}

	const kq = `${code}.KQ`;
	if (await probeSymbol(kq)) {
		symbolCache.set(code, kq);
		return kq;
	}

	throw new Error(`Symbol not found for code ${code}`);
}

// ── v7 Quote Batch Fetch ───────────────────────────────────────────

interface YahooQuote {
	symbol: string;
	shortName?: string;
	longName?: string;
	regularMarketPrice?: number;
	regularMarketChange?: number;
	regularMarketChangePercent?: number;
	regularMarketVolume?: number;
	regularMarketOpen?: number;
	regularMarketDayHigh?: number;
	regularMarketDayLow?: number;
	regularMarketPreviousClose?: number;
	regularMarketTime?: number;
	marketState?: string;
}

async function fetchQuotes(symbols: string[]): Promise<YahooQuote[]> {
	if (symbols.length === 0) { return []; }
	const joined = symbols.map(s => encodeURIComponent(s)).join(',');
	const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${joined}`;
	const body = await httpGet(url);
	const json = JSON.parse(body);
	return json.quoteResponse?.result ?? [];
}

function quoteToStockItem(q: YahooQuote): StockItem {
	const change = q.regularMarketChange ?? 0;
	const price = q.regularMarketPrice ?? 0;
	const volume = q.regularMarketVolume ?? 0;
	return {
		code: stripSuffix(q.symbol),
		name: q.longName ?? q.shortName ?? q.symbol,
		price,
		changePrice: change,
		changeRate: parseFloat((q.regularMarketChangePercent ?? 0).toFixed(2)),
		volume,
		direction: deriveDirection(change),
		marketStatus: mapMarketStatus(q.marketState),
		openPrice: q.regularMarketOpen ?? 0,
		highPrice: q.regularMarketDayHigh ?? 0,
		lowPrice: q.regularMarketDayLow ?? 0,
		tradingValue: volume * price,
		localTradedAt: q.regularMarketTime ? formatKSTTime(q.regularMarketTime) : '',
	};
}

function quoteToMarketIndex(q: YahooQuote, code: string, name: string): MarketIndex {
	const change = q.regularMarketChange ?? 0;
	const value = q.regularMarketPrice ?? 0;
	const volume = q.regularMarketVolume ?? 0;
	return {
		code,
		name,
		value,
		changeValue: parseFloat(change.toFixed(2)),
		changeRate: parseFloat((q.regularMarketChangePercent ?? 0).toFixed(2)),
		direction: deriveDirection(change),
		marketStatus: mapMarketStatus(q.marketState),
		openPrice: q.regularMarketOpen ?? 0,
		highPrice: q.regularMarketDayHigh ?? 0,
		lowPrice: q.regularMarketDayLow ?? 0,
		volume,
		tradingValue: volume * value,
		localTradedAt: q.regularMarketTime ? formatKSTTime(q.regularMarketTime) : '',
	};
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Batch-fetch stocks by 6-digit Korean codes.
 * Resolves symbols first (with cache), then fetches all in one v7 call.
 */
export async function fetchStocks(codes: string[]): Promise<StockItem[]> {
	// Resolve all symbols (cached ones are instant)
	const symbols = await Promise.all(codes.map(c => resolveSymbol(c).catch(() => null)));
	const validSymbols = symbols.filter((s): s is string => s !== null);

	if (validSymbols.length === 0) { return []; }

	const quotes = await fetchQuotes(validSymbols);
	return quotes.map(quoteToStockItem);
}

/**
 * Batch-fetch KOSPI and KOSDAQ indices.
 */
export async function fetchIndices(): Promise<MarketIndex[]> {
	const indexSymbols = Object.values(INDEX_MAP);
	const quotes = await fetchQuotes(indexSymbols);

	const results: MarketIndex[] = [];
	for (const q of quotes) {
		for (const [code, symbol] of Object.entries(INDEX_MAP)) {
			if (q.symbol === symbol) {
				results.push(quoteToMarketIndex(q, code, INDEX_NAMES[symbol] ?? code));
			}
		}
	}
	return results;
}

/**
 * Fetch a single stock (used for validation when adding by code).
 */
export async function fetchStock(code: string): Promise<StockItem> {
	const symbol = await resolveSymbol(code);
	const quotes = await fetchQuotes([symbol]);
	if (quotes.length === 0) {
		throw new Error(`No data for ${code}`);
	}
	return quoteToStockItem(quotes[0]);
}

/**
 * Validate a 6-digit stock code. Returns entry if valid, null otherwise.
 */
export async function searchStock(code: string): Promise<WatchlistEntry | null> {
	try {
		const stock = await fetchStock(code);
		return { code: stock.code, name: stock.name };
	} catch {
		return null;
	}
}

export interface SearchResult {
	code: string;
	name: string;
	market: string;
}

/**
 * Search stocks by name or keyword via Yahoo Finance search API.
 */
export async function searchStockByName(query: string): Promise<SearchResult[]> {
	const encoded = encodeURIComponent(query);
	const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encoded}&quotesCount=20&newsCount=0&lang=ko-KR&region=KR`;
	const body = await httpGet(url);
	const data = JSON.parse(body);

	const items: SearchResult[] = [];
	if (data.quotes && data.quotes.length > 0) {
		for (const q of data.quotes) {
			const symbol: string = q.symbol ?? '';
			// Filter to Korean stocks only (.KS or .KQ suffix)
			if (!symbol.endsWith('.KS') && !symbol.endsWith('.KQ')) {
				continue;
			}
			const code = stripSuffix(symbol);
			const market = symbol.endsWith('.KS') ? 'KOSPI' : 'KOSDAQ';

			// Cache the resolved symbol
			symbolCache.set(code, symbol);

			items.push({
				code,
				name: q.longname ?? q.shortname ?? symbol,
				market,
			});
		}
	}
	return items;
}
