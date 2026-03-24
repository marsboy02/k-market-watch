# Change Log

All notable changes to the "k-market-watch" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.1.4] - 2026-03-24

### Changed

- 종목 검색을 6자리 종목코드 입력 방식으로 변경 (입력 시 실시간 유효성 검증)
- 비주식 종목(뮤추얼펀드 등) 필터링 추가로 잘못된 종목 데이터 매칭 방지
- 종목명 표시 시 `shortName`을 우선 사용하여 정확도 개선

## [0.1.3] - 2026-03-24

### Changed

- **데이터 소스 변경**: 네이버 금융 API에서 Yahoo Finance API로 전면 마이그레이션
  - TOS(서비스 이용약관) 리스크 대비를 위한 사전 조치
  - `naverFinanceApi.ts` 제거, `yahooFinanceApi.ts` 신규 추가
- Yahoo Finance v8 Chart API를 활용하도록 주식/지수 데이터 fetching 로직 개선
- 패키징 설정(.vscodeignore) 정리

## [0.1.0] - 2026-03-23

### Added

- Initial release
- KOSPI/KOSDAQ 지수를 Status Bar에 실시간 표시
- 관심 종목 추가/삭제 기능
- 데이터 갱신 주기 설정 (기본 15초)
- 지수 이름 한/영 표기 전환 지원