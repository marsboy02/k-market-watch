import * as vscode from 'vscode';
import { WatchlistEntry } from '../models/types';

const STORAGE_KEY = 'k-market-watch.watchlist';

export class StorageService {
	constructor(private readonly context: vscode.ExtensionContext) {}

	getWatchlist(): WatchlistEntry[] {
		return this.context.globalState.get<WatchlistEntry[]>(STORAGE_KEY, []);
	}

	async addStock(entry: WatchlistEntry): Promise<void> {
		const list = this.getWatchlist();
		if (list.some(s => s.code === entry.code)) {
			return;
		}
		list.push(entry);
		await this.context.globalState.update(STORAGE_KEY, list);
	}

	async removeStock(code: string): Promise<void> {
		const list = this.getWatchlist().filter(s => s.code !== code);
		await this.context.globalState.update(STORAGE_KEY, list);
	}

	hasStock(code: string): boolean {
		return this.getWatchlist().some(s => s.code === code);
	}
}
