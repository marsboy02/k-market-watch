import * as vscode from 'vscode';
import { StorageService } from './services/storageService';
import { StockTreeProvider } from './providers/stockTreeProvider';
import { StatusBarManager } from './views/statusBar';
import { MarketDataService } from './services/marketDataService';
import { searchStock } from './services/naverFinanceApi';
import { PriceDirection } from './models/types';

const DEFAULT_WATCHLIST = [
	{ code: '005930', name: '삼성전자' },
	{ code: '000660', name: 'SK하이닉스' },
	{ code: '005380', name: '현대차' },
	{ code: '373220', name: 'LG에너지솔루션' },
	{ code: '012450', name: '한화에어로스페이스' },
	{ code: '207940', name: '삼성바이오로직스' },
	{ code: '402340', name: 'SK스퀘어' },
	{ code: '000270', name: '기아' },
	{ code: '034020', name: '두산에너빌리티' },
	{ code: '329180', name: 'HD현대중공업' },
	{ code: '105560', name: 'KB금융' },
	{ code: '068270', name: '셀트리온' },
	{ code: '028260', name: '삼성물산' },
	{ code: '055550', name: '신한지주' },
	{ code: '032830', name: '삼성생명' },
	{ code: '012330', name: '현대모비스' },
	{ code: '042660', name: '한화오션' },
	{ code: '006800', name: '미래에셋증권' },
	{ code: '010130', name: '고려아연' },
	{ code: '035420', name: 'NAVER' },
	{ code: '267260', name: 'HD현대일렉트릭' },
	{ code: '006400', name: '삼성SDI' },
	{ code: '042700', name: '한미반도체' },
	{ code: '015760', name: '한국전력' },
	{ code: '086790', name: '하나금융지주' },
	{ code: '009150', name: '삼성전기' },
	{ code: '272210', name: '한화시스템' },
	{ code: '005490', name: 'POSCO홀딩스' },
	{ code: '009540', name: 'HD한국조선해양' },
];

export function activate(context: vscode.ExtensionContext) {
	const storage = new StorageService(context);

	// 첫 실행 시 기본 종목 추가
	if (storage.getWatchlist().length === 0) {
		for (const entry of DEFAULT_WATCHLIST) {
			storage.addStock(entry);
		}
	}

	const treeProvider = new StockTreeProvider();
	const statusBar = new StatusBarManager();
	const dataService = new MarketDataService(storage, treeProvider, statusBar);

	// TreeView
	const treeView = vscode.window.createTreeView('k-market-watch.watchlist', {
		treeDataProvider: treeProvider,
		showCollapseAll: false,
	});

	// Commands
	const addStockCmd = vscode.commands.registerCommand('k-market-watch.addStock', async () => {
		const code = await vscode.window.showInputBox({
			prompt: '종목코드를 입력하세요',
			placeHolder: '예: 005930',
		});
		if (!code) {
			return;
		}

		try {
			const result = await searchStock(code.trim());
			if (!result) {
				vscode.window.showWarningMessage(`종목코드 "${code}"를 찾을 수 없습니다.`);
				return;
			}

			if (storage.hasStock(result.code)) {
				vscode.window.showInformationMessage(`${result.name}은(는) 이미 관심 종목에 있습니다.`);
				return;
			}

			await storage.addStock(result);
			treeView.message = undefined;
			vscode.window.showInformationMessage(`${result.name} (${result.code}) 추가됨`);
			dataService.start();
		} catch (err) {
			vscode.window.showErrorMessage(`종목 추가 실패: ${err}`);
		}
	});

	const removeStockCmd = vscode.commands.registerCommand('k-market-watch.removeStock', async (item?: { stockCode?: string }) => {
		if (item?.stockCode) {
			await storage.removeStock(item.stockCode);
			if (storage.getWatchlist().length === 0) {
				treeView.message = '종목을 추가하세요';
			}
			treeProvider.setWatchlist(storage.getWatchlist());
			treeProvider.refresh();
		}
	});

	const refreshCmd = vscode.commands.registerCommand('k-market-watch.refreshData', () => {
		dataService.start();
	});

	const showIndexDetail = (code: string) => {
		const data = statusBar.getIndexData(code);
		if (!data) {
			vscode.window.showInformationMessage(`${code} 데이터가 아직 로드되지 않았습니다.`);
			return;
		}

		const arrow = data.direction === PriceDirection.RISING ? '▲' : data.direction === PriceDirection.FALLING ? '▼' : '-';
		const sign = data.changeValue >= 0 ? '+' : '';
		const rateSign = data.changeRate >= 0 ? '+' : '';
		const fmt = (v: number) => v.toLocaleString('ko-KR', { minimumFractionDigits: 2 });
		const volFmt = (v: number) => v.toLocaleString('ko-KR');
		const valueFmt = (v: number) => {
			if (v >= 1_0000_0000) { return (v / 1_0000_0000).toFixed(2) + '조'; }
			if (v >= 10000) { return (v / 10000).toFixed(0) + '억'; }
			return v.toLocaleString('ko-KR');
		};

		const items: vscode.QuickPickItem[] = [
			{ label: `${data.name}`, kind: vscode.QuickPickItemKind.Separator },
			{ label: `$(graph-line) 현재가`, description: `${fmt(data.value)} ${arrow}${sign}${fmt(data.changeValue)} (${rateSign}${data.changeRate}%)` },
			{ label: `$(arrow-up) 시가`, description: fmt(data.openPrice) },
			{ label: `$(triangle-up) 고가`, description: fmt(data.highPrice) },
			{ label: `$(triangle-down) 저가`, description: fmt(data.lowPrice) },
			{ label: `$(pulse) 거래량`, description: volFmt(data.volume) },
			{ label: `$(credit-card) 거래대금`, description: valueFmt(data.tradingValue) },
			{ label: `$(info) 상태`, description: data.marketStatus },
			{ label: `$(clock) 기준시각`, description: data.localTradedAt },
		];

		vscode.window.showQuickPick(items, {
			title: `${data.name} 상세 정보`,
			placeHolder: '지수 상세 정보',
		});
	};

	const showKospiDetailCmd = vscode.commands.registerCommand('k-market-watch.showKospiDetail', () => showIndexDetail('KOSPI'));
	const showKosdaqDetailCmd = vscode.commands.registerCommand('k-market-watch.showKosdaqDetail', () => showIndexDetail('KOSDAQ'));

	// Configuration change listener
	const configListener = vscode.workspace.onDidChangeConfiguration(e => {
		if (e.affectsConfiguration('k-market-watch')) {
			dataService.onConfigurationChanged();
		}
	});

	context.subscriptions.push(treeView, statusBar, dataService, addStockCmd, removeStockCmd, refreshCmd, showKospiDetailCmd, showKosdaqDetailCmd, configListener);

	// Start
	dataService.start();
}

export function deactivate() {}
