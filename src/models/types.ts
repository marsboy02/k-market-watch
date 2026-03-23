export enum PriceDirection {
	RISING = '2',
	FLAT = '3',
	FALLING = '5',
}

export interface StockItem {
	code: string;
	name: string;
	price: number;
	changeRate: number;
	changePrice: number;
	volume: number;
	direction: PriceDirection;
	marketStatus: string;
	openPrice: number;
	highPrice: number;
	lowPrice: number;
	tradingValue: number;
	localTradedAt: string;
}

export interface MarketIndex {
	code: string;
	name: string;
	value: number;
	changeRate: number;
	changeValue: number;
	direction: PriceDirection;
	marketStatus: string;
	openPrice: number;
	highPrice: number;
	lowPrice: number;
	volume: number;
	tradingValue: number;
	localTradedAt: string;
}

export interface WatchlistEntry {
	code: string;
	name: string;
}
