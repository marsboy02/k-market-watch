import * as https from 'https';
import { NaverRealtimeResponse, StockItem, MarketIndex, WatchlistEntry, PriceDirection } from '../models/types';

const BASE_URL = 'https://polling.finance.naver.com/api/realtime/domestic';
const TIMEOUT_MS = 5000;

function httpGet(url: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const req = https.get(url, { timeout: TIMEOUT_MS }, (res) => {
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

function parseDirection(code: string): PriceDirection {
	if (code === PriceDirection.RISING) { return PriceDirection.RISING; }
	if (code === PriceDirection.FALLING) { return PriceDirection.FALLING; }
	return PriceDirection.FLAT;
}

export async function fetchStock(code: string): Promise<StockItem> {
	const body = await httpGet(`${BASE_URL}/stock/${code}`);
	const data: NaverRealtimeResponse = JSON.parse(body);
	const d = data.datas[0];

	return {
		code: d.itemCode,
		name: d.stockName,
		price: parseFloat(d.closePriceRaw),
		changeRate: parseFloat(d.fluctuationsRatioRaw),
		changePrice: parseFloat(d.compareToPreviousClosePriceRaw),
		volume: parseFloat(d.accumulatedTradingVolumeRaw),
		direction: parseDirection(d.compareToPreviousPrice.code),
		marketStatus: d.marketStatus,
		openPrice: parseFloat(d.openPriceRaw),
		highPrice: parseFloat(d.highPriceRaw),
		lowPrice: parseFloat(d.lowPriceRaw),
		tradingValue: parseFloat(d.accumulatedTradingValueRaw),
		localTradedAt: d.localTradedAt,
	};
}

export async function fetchIndex(code: string): Promise<MarketIndex> {
	const body = await httpGet(`${BASE_URL}/index/${code}`);
	const data: NaverRealtimeResponse = JSON.parse(body);
	const d = data.datas[0];

	return {
		code: d.itemCode ?? d.symbolCode,
		name: d.stockName,
		value: parseFloat(d.closePriceRaw),
		changeRate: parseFloat(d.fluctuationsRatioRaw),
		changeValue: parseFloat(d.compareToPreviousClosePriceRaw),
		direction: parseDirection(d.compareToPreviousPrice.code),
		marketStatus: d.marketStatus,
		openPrice: parseFloat(d.openPriceRaw),
		highPrice: parseFloat(d.highPriceRaw),
		lowPrice: parseFloat(d.lowPriceRaw),
		volume: parseFloat(d.accumulatedTradingVolumeRaw),
		tradingValue: parseFloat(d.accumulatedTradingValueRaw),
		localTradedAt: d.localTradedAt,
	};
}

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

export async function searchStockByName(query: string): Promise<SearchResult[]> {
	const encoded = encodeURIComponent(query);
	const url = `https://ac.stock.naver.com/ac?q=${encoded}&target=stock`;
	const body = await httpGet(url);
	const data = JSON.parse(body);

	const items: SearchResult[] = [];
	if (data.items && data.items.length > 0) {
		for (const item of data.items) {
			items.push({
				code: item.code,
				name: item.name,
				market: item.typeName ?? item.typeCode ?? '',
			});
		}
	}
	return items;
}
