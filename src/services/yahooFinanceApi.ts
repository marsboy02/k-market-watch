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

// ── v8 Chart Fetch ────────────────────────────────────────────────

interface ChartData {
	symbol: string;
	shortName?: string;
	longName?: string;
	regularMarketPrice: number;
	regularMarketDayHigh: number;
	regularMarketDayLow: number;
	regularMarketVolume: number;
	regularMarketTime: number;
	chartPreviousClose: number;
	openPrice: number;
	regularPeriodStart: number;
	regularPeriodEnd: number;
}

async function fetchChart(symbol: string): Promise<ChartData> {
	const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
	const body = await httpGet(url);
	const json = JSON.parse(body);
	const result = json.chart?.result?.[0];
	if (!result) {
		throw new Error(`No chart data for ${symbol}`);
	}
	const meta = result.meta;
	const quote = result.indicators?.quote?.[0];
	return {
		symbol: meta.symbol,
		shortName: meta.shortName,
		longName: meta.longName,
		regularMarketPrice: meta.regularMarketPrice ?? 0,
		regularMarketDayHigh: meta.regularMarketDayHigh ?? 0,
		regularMarketDayLow: meta.regularMarketDayLow ?? 0,
		regularMarketVolume: meta.regularMarketVolume ?? 0,
		regularMarketTime: meta.regularMarketTime ?? 0,
		chartPreviousClose: meta.chartPreviousClose ?? 0,
		openPrice: quote?.open?.[0] ?? 0,
		regularPeriodStart: meta.currentTradingPeriod?.regular?.start ?? 0,
		regularPeriodEnd: meta.currentTradingPeriod?.regular?.end ?? 0,
	};
}

function chartMarketStatus(data: ChartData): string {
	const now = Math.floor(Date.now() / 1000);
	if (now >= data.regularPeriodStart && now < data.regularPeriodEnd) {
		return 'OPEN';
	}
	return 'CLOSE';
}

function chartToStockItem(data: ChartData): StockItem {
	const price = data.regularMarketPrice;
	const prevClose = data.chartPreviousClose;
	const change = prevClose ? price - prevClose : 0;
	const changeRate = prevClose ? parseFloat(((change / prevClose) * 100).toFixed(2)) : 0;
	const volume = data.regularMarketVolume;
	return {
		code: stripSuffix(data.symbol),
		name: data.longName ?? data.shortName ?? data.symbol,
		price,
		changePrice: change,
		changeRate,
		volume,
		direction: deriveDirection(change),
		marketStatus: chartMarketStatus(data),
		openPrice: data.openPrice,
		highPrice: data.regularMarketDayHigh,
		lowPrice: data.regularMarketDayLow,
		tradingValue: volume * price,
		localTradedAt: data.regularMarketTime ? formatKSTTime(data.regularMarketTime) : '',
	};
}

function chartToMarketIndex(data: ChartData, code: string, name: string): MarketIndex {
	const value = data.regularMarketPrice;
	const prevClose = data.chartPreviousClose;
	const change = prevClose ? value - prevClose : 0;
	const changeRate = prevClose ? parseFloat(((change / prevClose) * 100).toFixed(2)) : 0;
	const volume = data.regularMarketVolume;
	return {
		code,
		name,
		value,
		changeValue: parseFloat(change.toFixed(2)),
		changeRate,
		direction: deriveDirection(change),
		marketStatus: chartMarketStatus(data),
		openPrice: data.openPrice,
		highPrice: data.regularMarketDayHigh,
		lowPrice: data.regularMarketDayLow,
		volume,
		tradingValue: volume * value,
		localTradedAt: data.regularMarketTime ? formatKSTTime(data.regularMarketTime) : '',
	};
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Fetch stocks by 6-digit Korean codes.
 * Resolves symbols first (with cache), then fetches each via v8 chart API.
 */
export async function fetchStocks(codes: string[]): Promise<StockItem[]> {
	const symbolResults = await Promise.allSettled(codes.map(c => resolveSymbol(c)));
	const validSymbols = symbolResults
		.filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
		.map(r => r.value);

	if (validSymbols.length === 0) { return []; }

	const chartResults = await Promise.allSettled(validSymbols.map(s => fetchChart(s)));
	return chartResults
		.filter((r): r is PromiseFulfilledResult<ChartData> => r.status === 'fulfilled')
		.map(r => chartToStockItem(r.value));
}

/**
 * Fetch KOSPI and KOSDAQ indices via v8 chart API.
 */
export async function fetchIndices(): Promise<MarketIndex[]> {
	const entries = Object.entries(INDEX_MAP);
	const chartResults = await Promise.allSettled(entries.map(([, symbol]) => fetchChart(symbol)));

	const results: MarketIndex[] = [];
	for (let i = 0; i < entries.length; i++) {
		const [code, symbol] = entries[i];
		const result = chartResults[i];
		if (result.status === 'fulfilled') {
			results.push(chartToMarketIndex(result.value, code, INDEX_NAMES[symbol] ?? code));
		}
	}
	return results;
}

/**
 * Fetch a single stock (used for validation when adding by code).
 */
export async function fetchStock(code: string): Promise<StockItem> {
	const symbol = await resolveSymbol(code);
	return chartToStockItem(await fetchChart(symbol));
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
