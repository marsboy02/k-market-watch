import * as https from 'https';
import { StockItem, MarketIndex, WatchlistEntry, PriceDirection } from '../models/types';

const TIMEOUT_MS = 10000;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)';

// Cache: bare 6-digit code -> Yahoo symbol with TTL (e.g. '005930' -> '005930.KS')
const SYMBOL_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const SYMBOL_CACHE_MAX_SIZE = 200;

interface SymbolCacheEntry {
	symbol: string;
	cachedAt: number;
}

const symbolCache = new Map<string, SymbolCacheEntry>();

function getCachedSymbol(code: string): string | undefined {
	const entry = symbolCache.get(code);
	if (!entry) { return undefined; }
	if (Date.now() - entry.cachedAt > SYMBOL_CACHE_TTL_MS) {
		symbolCache.delete(code);
		return undefined;
	}
	return entry.symbol;
}

function setCachedSymbol(code: string, symbol: string): void {
	if (symbolCache.size >= SYMBOL_CACHE_MAX_SIZE) {
		// Evict oldest entry
		let oldestKey: string | undefined;
		let oldestTime = Infinity;
		for (const [key, entry] of symbolCache) {
			if (entry.cachedAt < oldestTime) {
				oldestTime = entry.cachedAt;
				oldestKey = key;
			}
		}
		if (oldestKey) { symbolCache.delete(oldestKey); }
	}
	symbolCache.set(code, { symbol, cachedAt: Date.now() });
}

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
		const result = json.chart?.result?.[0];
		if (!result) { return false; }
		// Filter out non-equity instruments (e.g. mutual funds that share the same code)
		const type = result.meta?.instrumentType;
		if (type && type !== 'EQUITY') { return false; }
		return true;
	} catch {
		return false;
	}
}

async function resolveSymbol(code: string): Promise<string> {
	const cached = getCachedSymbol(code);
	if (cached) { return cached; }

	const ks = `${code}.KS`;
	if (await probeSymbol(ks)) {
		setCachedSymbol(code, ks);
		return ks;
	}

	const kq = `${code}.KQ`;
	if (await probeSymbol(kq)) {
		setCachedSymbol(code, kq);
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
		name: data.shortName ?? data.longName ?? data.symbol,
		price,
		changePrice: change,
		changeRate,
		volume,
		direction: deriveDirection(change),
		marketStatus: chartMarketStatus(data),
		openPrice: data.openPrice,
		highPrice: data.regularMarketDayHigh,
		lowPrice: data.regularMarketDayLow,
		estimatedTradingValue: volume * price,
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
		estimatedTradingValue: volume * value,
		localTradedAt: data.regularMarketTime ? formatKSTTime(data.regularMarketTime) : '',
	};
}

// ── Concurrency Limiter ─────────────────────────────────────────────

const CONCURRENCY_LIMIT = 5;

async function mapWithConcurrency<T, R>(
	items: T[],
	fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
	const results: PromiseSettledResult<R>[] = new Array(items.length);
	let index = 0;

	async function worker(): Promise<void> {
		while (index < items.length) {
			const i = index++;
			try {
				results[i] = { status: 'fulfilled', value: await fn(items[i]) };
			} catch (reason) {
				results[i] = { status: 'rejected', reason };
			}
		}
	}

	const workers = Array.from(
		{ length: Math.min(CONCURRENCY_LIMIT, items.length) },
		() => worker(),
	);
	await Promise.all(workers);
	return results;
}

// ── Batch Symbol Resolution ─────────────────────────────────────────

async function batchResolveUncached(codes: string[]): Promise<void> {
	const uncached = codes.filter(c => !getCachedSymbol(c));
	if (uncached.length === 0) { return; }

	// Try search API to resolve multiple codes at once
	const searchResults = await Promise.allSettled(
		uncached.map(async (code) => {
			try {
				const encoded = encodeURIComponent(code);
				const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encoded}&quotesCount=5&newsCount=0&lang=ko-KR&region=KR`;
				const body = await httpGet(url);
				const data = JSON.parse(body);
				if (data.quotes) {
					for (const q of data.quotes) {
						const symbol: string = q.symbol ?? '';
						if (symbol.endsWith('.KS') || symbol.endsWith('.KQ')) {
							const resolved = stripSuffix(symbol);
							if (resolved === code) {
								setCachedSymbol(code, symbol);
								return;
							}
						}
					}
				}
			} catch {
				// Fall through — resolveSymbol will handle via probe
			}
		}),
	);
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Fetch stocks by 6-digit Korean codes.
 * Batch-resolves uncached symbols via search API, then fetches with concurrency limit.
 */
export async function fetchStocks(codes: string[]): Promise<StockItem[]> {
	// Pre-resolve uncached symbols in batch via search API
	await batchResolveUncached(codes);

	const symbolResults = await mapWithConcurrency(codes, c => resolveSymbol(c));
	const validSymbols = symbolResults
		.filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
		.map(r => r.value);

	if (validSymbols.length === 0) { return []; }

	const chartResults = await mapWithConcurrency(validSymbols, s => fetchChart(s));
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
			setCachedSymbol(code, symbol);

			items.push({
				code,
				name: q.longname ?? q.shortname ?? symbol,
				market,
			});
		}
	}
	return items;
}
