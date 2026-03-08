import * as vscode from 'vscode';
import { fetchStock, fetchIndex } from './naverFinanceApi';
import { StorageService } from './storageService';
import { StockTreeProvider } from '../providers/stockTreeProvider';
import { StatusBarManager } from '../views/statusBar';
import { isMarketOpen } from '../utils/marketHours';

const MIN_INTERVAL_SEC = 3;

export class MarketDataService implements vscode.Disposable {
	private timer: ReturnType<typeof setInterval> | undefined;
	private intervalMs: number;

	constructor(
		private readonly storage: StorageService,
		private readonly treeProvider: StockTreeProvider,
		private readonly statusBar: StatusBarManager,
	) {
		this.intervalMs = this.getConfiguredInterval();
	}

	private getConfiguredInterval(): number {
		const config = vscode.workspace.getConfiguration('k-market-watch');
		const sec = Math.max(config.get<number>('refreshInterval', 5), MIN_INTERVAL_SEC);
		return sec * 1000;
	}

	start(): void {
		this.stop();
		this.applyVisibility();
		this.fetchAndUpdate();
		this.timer = setInterval(() => this.fetchAndUpdate(), this.intervalMs);
	}

	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
	}

	onConfigurationChanged(): void {
		this.intervalMs = this.getConfiguredInterval();
		this.applyVisibility();
		this.start();
	}

	private applyVisibility(): void {
		const config = vscode.workspace.getConfiguration('k-market-watch');
		this.statusBar.updateVisibility(
			config.get<boolean>('showKospi', true),
			config.get<boolean>('showKosdaq', true),
		);
	}

	private async fetchAndUpdate(): Promise<void> {
		const watchlist = this.storage.getWatchlist();
		this.treeProvider.setWatchlist(watchlist);

		if (!isMarketOpen()) {
			// 장 외 시간: 1회만 fetch해서 마지막 데이터 표시, 이후 skip
			// 첫 로드 시에는 데이터를 가져옴
		}

		const stockPromises = watchlist.map(entry =>
			fetchStock(entry.code).catch(err => {
				console.error(`[K-Market Watch] Failed to fetch ${entry.code}:`, err);
				return null;
			})
		);

		const indexPromises = [
			fetchIndex('KOSPI').catch(err => {
				console.error('[K-Market Watch] Failed to fetch KOSPI:', err);
				return null;
			}),
			fetchIndex('KOSDAQ').catch(err => {
				console.error('[K-Market Watch] Failed to fetch KOSDAQ:', err);
				return null;
			}),
		];

		const results = await Promise.allSettled([
			Promise.all(stockPromises),
			Promise.all(indexPromises),
		]);

		// Update stocks
		if (results[0].status === 'fulfilled') {
			const stocks = results[0].value.filter((s): s is NonNullable<typeof s> => s !== null);
			this.treeProvider.updateStockData(stocks);
		}

		// Update indices
		if (results[1].status === 'fulfilled') {
			for (const idx of results[1].value) {
				if (idx) {
					this.statusBar.updateIndex(idx);
				}
			}
		}
	}

	dispose(): void {
		this.stop();
	}
}
