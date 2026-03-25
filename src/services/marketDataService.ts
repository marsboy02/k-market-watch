import * as vscode from 'vscode';
import { fetchStocks, fetchIndices } from './yahooFinanceApi';
import { StorageService } from './storageService';
import { StockTreeProvider } from '../providers/stockTreeProvider';
import { StatusBarManager } from '../views/statusBar';
import { isMarketOpen } from '../utils/marketHours';

const MIN_INTERVAL_SEC = 3;

export class MarketDataService implements vscode.Disposable {
	private timer: ReturnType<typeof setInterval> | undefined;
	private intervalMs: number;
	private hasFetchedWhileClosed = false;

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

		if (isMarketOpen()) {
			this.hasFetchedWhileClosed = false;
		} else {
			if (this.hasFetchedWhileClosed) {
				return;
			}
			this.hasFetchedWhileClosed = true;
		}

		const codes = watchlist.map(entry => entry.code);

		const results = await Promise.allSettled([
			fetchStocks(codes).catch(err => {
				console.error('[K-Market Watch] Failed to fetch stocks:', err);
				return [];
			}),
			fetchIndices().catch(err => {
				console.error('[K-Market Watch] Failed to fetch indices:', err);
				return [];
			}),
		]);

		// Update stocks
		if (results[0].status === 'fulfilled') {
			this.treeProvider.updateStockData(results[0].value);
		}

		// Update indices
		if (results[1].status === 'fulfilled') {
			for (const idx of results[1].value) {
				this.statusBar.updateIndex(idx);
			}
		}
	}

	dispose(): void {
		this.stop();
	}
}
