import * as vscode from 'vscode';
import { StockItem, PriceDirection, WatchlistEntry } from '../models/types';

type TreeNode = StockParentItem | StockDetailItem;

export class StockParentItem extends vscode.TreeItem {
	constructor(
		public readonly stockCode: string,
		public readonly stockName: string,
		description: string,
		direction: PriceDirection,
	) {
		super(stockName, vscode.TreeItemCollapsibleState.Collapsed);
		this.description = description;
		this.contextValue = 'stockItem';

		if (direction === PriceDirection.RISING) {
			this.iconPath = new vscode.ThemeIcon('triangle-up', new vscode.ThemeColor('charts.red'));
		} else if (direction === PriceDirection.FALLING) {
			this.iconPath = new vscode.ThemeIcon('triangle-down', new vscode.ThemeColor('charts.blue'));
		} else {
			this.iconPath = new vscode.ThemeIcon('dash');
		}
	}
}

class StockDetailItem extends vscode.TreeItem {
	constructor(label: string, value: string) {
		super(label, vscode.TreeItemCollapsibleState.None);
		this.description = value;
	}
}

function formatNumber(n: number): string {
	return n.toLocaleString('ko-KR');
}

function formatTradingValue(value: number): string {
	if (value >= 1_000_000_000_000) {
		return `${(value / 1_000_000_000_000).toFixed(1)}조`;
	}
	if (value >= 100_000_000) {
		return `${(value / 100_000_000).toFixed(0)}억`;
	}
	return formatNumber(value);
}

export class StockTreeProvider implements vscode.TreeDataProvider<TreeNode> {
	private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private stockData = new Map<string, StockItem>();
	private watchlist: WatchlistEntry[] = [];

	setWatchlist(entries: WatchlistEntry[]): void {
		this.watchlist = entries;
	}

	updateStockData(items: StockItem[]): void {
		for (const item of items) {
			this.stockData.set(item.code, item);
		}
		this._onDidChangeTreeData.fire();
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: TreeNode): TreeNode {
		return element;
	}

	getChildren(element?: TreeNode): TreeNode[] {
		// 하위 노드: 상세 정보
		if (element instanceof StockParentItem) {
			const data = this.stockData.get(element.stockCode);
			if (!data) {
				return [new StockDetailItem('데이터 없음', '')];
			}

			const sign = data.changePrice >= 0 ? '+' : '';
			const status = data.marketStatus === 'CLOSE' ? '장 마감' : '거래 중';

			return [
				new StockDetailItem('현재가', formatNumber(data.price)),
				new StockDetailItem('전일대비', `${sign}${formatNumber(data.changePrice)} (${sign}${data.changeRate}%)`),
				new StockDetailItem('시가', formatNumber(data.openPrice)),
				new StockDetailItem('고가', formatNumber(data.highPrice)),
				new StockDetailItem('저가', formatNumber(data.lowPrice)),
				new StockDetailItem('거래량', formatNumber(data.volume)),
				new StockDetailItem('거래대금(추정)', formatTradingValue(data.estimatedTradingValue)),
				new StockDetailItem('상태', status),
			];
		}

		// 최상위: 종목 목록
		if (this.watchlist.length === 0) {
			return [];
		}

		return this.watchlist.map(entry => {
			const data = this.stockData.get(entry.code);
			if (data) {
				const priceStr = formatNumber(data.price);
				const sign = data.changeRate >= 0 ? '+' : '';
				const desc = `${priceStr}  ${sign}${data.changeRate}%`;
				return new StockParentItem(entry.code, entry.name, desc, data.direction);
			}
			return new StockParentItem(entry.code, entry.name, '로딩 중...', PriceDirection.FLAT);
		});
	}
}
