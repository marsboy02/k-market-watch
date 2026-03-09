import * as vscode from 'vscode';
import { MarketIndex, PriceDirection } from '../models/types';

export class StatusBarManager implements vscode.Disposable {
	private kospiItem: vscode.StatusBarItem;
	private kosdaqItem: vscode.StatusBarItem;
	private indexData: Map<string, MarketIndex> = new Map();

	constructor() {
		this.kospiItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
		this.kospiItem.command = 'k-market-watch.showKospiDetail';
		this.kosdaqItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
		this.kosdaqItem.command = 'k-market-watch.showKosdaqDetail';
	}

	updateIndex(index: MarketIndex): void {
		this.indexData.set(index.code, index);

		const item = index.code === 'KOSPI' ? this.kospiItem : this.kosdaqItem;
		const arrow = index.direction === PriceDirection.RISING ? '▲' : index.direction === PriceDirection.FALLING ? '▼' : '-';
		const sign = index.changeRate >= 0 ? '+' : '';
		const displayName = this.getDisplayName(index);
		item.text = `$(graph-line) ${displayName} ${index.value.toLocaleString('ko-KR', { minimumFractionDigits: 2 })} ${arrow}${sign}${index.changeRate}%`;

		if (index.direction === PriceDirection.RISING) {
			item.color = '#FF0000';
		} else if (index.direction === PriceDirection.FALLING) {
			item.color = '#4488FF';
		} else {
			item.color = undefined;
		}
	}

	private getDisplayName(index: MarketIndex): string {
		const config = vscode.workspace.getConfiguration('k-market-watch');
		const lang = config.get<string>('indexNameLanguage', 'korean');
		if (lang === 'english') {
			return index.code;
		}
		return index.name;
	}

	getIndexData(code: string): MarketIndex | undefined {
		return this.indexData.get(code);
	}

	updateVisibility(showKospi: boolean, showKosdaq: boolean): void {
		if (showKospi) {
			this.kospiItem.show();
		} else {
			this.kospiItem.hide();
		}
		if (showKosdaq) {
			this.kosdaqItem.show();
		} else {
			this.kosdaqItem.hide();
		}
	}

	dispose(): void {
		this.kospiItem.dispose();
		this.kosdaqItem.dispose();
	}
}
