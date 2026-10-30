# ActFlow 대회용 실행본 정리

작성: 2026-10-07, Asia/Seoul. 요청: 대회용 제품에서 다른 AI 제공자·Agent 및 로컬 모델 시스템을 제거한다.

## 결정과 범위

최신 2.0의 Living Task, memory, 승인, 검증, 이벤트와 Wake를 프로젝트 루트의 실행본으로 옮겼다. 실 추론은 **Nebius Token Factory의 NVIDIA 모델** 한 경로로 제한한다.

다른 제공자와 로컬 추론이 모두 대회 규정상 금지라는 뜻은 아니다. 대회는 Nebius 실행 경로와 NVIDIA 오픈 모델 사용을 요구하며, 이번 정리는 사용자가 요청한 제출 범위 선택이다. [공식 규정](https://nebiusglobalaihackathon.devpost.com/rules)

## 제거한 기능

| 대상 | 실제 처리 |
|---|---|
| OpenAI GPT / Anthropic Claude / Google Gemini | 모델 어댑터·프리셋·API 선택·키 저장 API·SDK 의존성 제거 |
| 로컬 Qwen / TabbyAPI / 외부 로컬 서버 | LOCAL 모드·서버 주소·인증 키 경로·설치 및 다운로드 도우미 제거 |
| 임의 호환 API | 사용자 base URL 설정 제거, 공식 Nebius 주소만 서버에서 허용 |
| 로컬 실패 → 외부 API 자동 전환 | 라우팅 정책과 fallback 구현 제거 |
| 작업별 LOCAL/API override | 화면·API·타입·새 DB 스키마에서 제거, 기존 override 열은 마이그레이션에서 정리 |
| 일반 사용자용 Demo 모델 선택 | 화면과 프리셋에서 제거, 일반·production API에서는 선택 차단 |
| 오래된 제공자 안내 | 현재 README·설정·제공자 안내를 Nebius/NVIDIA로 교체, 과거 문서는 history로 이동 |

별도 외부 Agent framework를 호출하는 실행 경로는 찾지 못했다. 다른 도구를 잔뜩 연결하는 방향으로 새 Agent framework를 추가하지 않았다.

## 유지한 기능

- Living Task와 동일 작업의 목표·메모리·근거·에피소드.
- 정책, 승인, 정확한 주소 경계, 비밀 값과 공유 범위 검사.
- 문서 파싱, 직원 조회, XLSX/DOCX 생성, 파일 재열기와 해시 검사.
- 임시 파일 준비와 거절 시 삭제, 실패·불확실한 외부 효과 보호.
- 이벤트 중복 방지, 작업 lease, 재시작 복구와 Node worker의 Wake.
- SQLite와 파일 저장소, 브라우저와 개발용 서버.

이 기능들은 로컬 LLM이 아니다. 원격으로 worker를 운영해도 업무 상태와 실행 결과를 보관하는 데 필요하다.

테스트용 DemoProvider는 명시적인 개발 테스트에서만 사용한다. `realModelCalled=false`이며 production에서는 테스트 플래그를 켜도 선택할 수 없다. 테스트 fixture를 실제 NVIDIA 호출 증거로 계산하지 않는다.

## Nebius 연결

- 고정 endpoint: `https://api.tokenfactory.nebius.com/v1`.
- 기본 후보: `nvidia/nemotron-3-super-120b-a12b`.
- 모델 목록에서 정확한 ID를 찾고 소량 추론 응답을 받아야 연결 테스트가 성공한다.
- JSON 계획의 수리 요청은 같은 NVIDIA 모델에서 최대 한 번이다.
- 서버가 hostingProvider=Nebius, modelPublisher=NVIDIA, 응답 ID·모델·시간·응답 해시·토큰 사용량을 기록한다.
- 키 누락·연결 실패·응답 모델 불일치는 실패로 표시한다. 다른 모델·fixture로 대체하지 않는다.

계정 보유는 확인됐지만 크레딧과 접속은 확인이 필요하다. 이번 검증에 실제 Nebius 키나 유료 추론을 사용하지 않았다. [공식 API 안내](https://docs.tokenfactory.nebius.com/quickstart), [공식 NVIDIA 모델 예제](https://github.com/nebius/token-factory-cookbook/blob/main/models/nemotron/nemotron3-super-120B.md)

## 데이터 보존과 검증

변경 전 root 소스 ZIP과 기존 SQLite의 일관된 snapshot을 `data/runtime/hackathon-cleanup-2026-10-07/`에 저장했다. 기존 `.env.local`, 암호화 마스터 키, 세션 키를 수정하지 않았다.

마이그레이션은 모델 설정만 현재 형식으로 전환한다. 작업·승인·메모리·파일과 불투명한 과거 암호화 자격 증명은 보존하며, 현재 API에서는 과거 제공자 키를 선택하거나 읽을 수 없다. 마이그레이션을 두 번 실행해도 데이터와 보수적인 실행 설정을 유지하는 검사를 포함한다.

과거 ZIP, review 소스와 실행 자료는 복구·비교를 위해 유지한다. `data/runtime`은 Git과 TypeScript 빌드에서 제외하므로 대회 제출 실행 경로에 포함되지 않는다.

## 추가로 고친 실행 결함

제공자 이름만 바꾸는 것으로 끝내지 않고, 실제 실행 경로에서 발견한 결함을 수정했다.

| 결함 | 현재 동작과 검증 |
|---|---|
| 서버가 추가한 실 추론 영수증을 엄격한 모델 JSON 스키마가 다시 거부 | 모델 원문과 서버 실행 결과의 스키마를 분리한다. 모델이 작성한 영수증은 거부하고, 실제 Nebius adapter가 만든 영수증은 엔진·DB까지 보존한다. HTTP mock 기반 통합 검사이며 실 계정 호출은 아니다. |
| JSON escape로 감춘 민감정보·파일 이름이 입력 경계를 빠져나감 | 원문과 제한된 JSON 해제 문자열, source name·locale을 검사한다. 너무 크거나 복잡한 입력도 중단한다. |
| 분석 요청이 저장된 모델 설정을 덮어씀 | 요청 본문의 provider/model/effort 선택을 거부하고, 소유자별 저장 설정만 사용한다. |
| Next.js의 별도 번들에서 생성한 오류가 API에서 일반 500으로 바뀜 | 허용한 도메인 오류의 안정적인 식별자를 사용한다. 중복 승인·충돌은 409, 권한·설정 오류는 해당 상태로 반환하며 알 수 없는 내부 오류는 공개하지 않는다. |
| 파일에 이름이 메모로만 있어도 명단 검증 성공 | 아래의 구조·값 검사와 검증 후 확정을 적용한다. |
| 파일 확정 실패와 역방향 이동 실패가 겹치면 실제 파일 위치를 놓침 | 살아 있는 파일의 실제 경로와 DELETE_FAILED 상태, 두 실패 원인을 기록한다. 후속 복구가 그 파일을 찾아 물리적으로 삭제하는 고장 주입 검사를 통과했다. |

검토 에이전트는 위 실행 경계와 마이그레이션을 읽기 전용으로 검토했다. 마지막 이중 실패 복구도 별도 probe에서 실제 파일 삭제까지 확인했다.

## Verify → Commit / Recover의 현재 구현

교육 제출 업무의 파일에 한해 version 1의 구체적인 검증 목표를 만든다.

- XLSX: 보이는 참석자 명단 시트 하나, 정확한 다섯 열, 대상 행 수와 원본 ID·이름·부서·직급·대상 여부를 비교한다. 누락·중복·다른 값·추가 시트·수식 셀은 실패다.
- DOCX: 서버가 구성한 승인 회신의 제목·수신자·본문·참석 인원·총비용·초안 표기를 비교한다.
- 검증 목표 해시와 각 조건의 검사 결과를 보존한다. 임시 파일을 다시 읽어 원래 해시와 대조하고, 검증 통과 뒤 확정한다. 이동 전후에도 해시를 확인한다.
- 파일 검증 실패 시 미확정 파일을 정리하고 그 결과를 기록한다. 삭제에 실패하면 실제 남은 파일과 ROLLBACK_FAILED를 유지한다. 복구 완료로 표시하지 않는다.

이는 교육 명단·회신의 제한된 검증이다. 모델이 원문에서 추출한 모든 사실을 독립적으로 증명하거나 일반 업무 전체의 완료를 판정하는 Goal Contract는 아니다. XLSX 수식을 계산하는 기능도 아니다. 이미 확정된 모든 이전 단계와 외부 효과를 되돌리는 분산 트랜잭션으로 주장하지 않는다.

## 최종 검증 결과

2026-10-07의 현재 실행 소스를 대상으로 완료했다. 기계가 읽는 요약은 [verification-results.json](verification-results.json)에 있다.

| 검사 | 결과 |
|---|---|
| locked dependencies 설치 `npm ci` | 성공, SQLite native 모듈 실행 확인 |
| 타입 `npm run check` | 통과 |
| 단위·통합 `npm run test` | 75개 파일, **428개 테스트 통과**, 실패 0 |
| production `npm run build` | 통과, 제거한 모델 선택 API가 route manifest에 없음 |
| 브라우저 `npm run test:e2e` | **11개 통과**, 실패·skip·flaky 0 |
| fixture benchmark, 방식별 20회 | 정상 준비 40회와 별도 거절 복구 40회 통과, 실 모델 호출 0 |
| 제거 SDK 설치 검사 | OpenAI·Anthropic·Google GenAI SDK 모두 없음 |
| `git diff --check` | 통과 |
| `npm audit` | high/critical 0, moderate 3 |

브라우저 검사는 정상 준비·승인, 중복 승인 차단, 거절 후 실제 삭제, 고장 시 실패 표시, 창을 닫고 재접속한 동일 작업의 승인 대기 유지, Nebius만 보이는 설정을 포함한다. 명단 구조·값·수식과 파일 이동/삭제 고장 검사는 단위·통합 검사에서 수행했다.

벤치마크는 동일 교육 샘플의 결정적 fixture 측정이다. 승인 요청부터 파일 확정까지 p50은 수동 방식 45.47ms, 선실행 방식 27.50ms였다. 사람의 검토·외부 대기·실 모델·실메일 시간과 독립 oracle은 포함하지 않는다. 이를 현실의 업무 완료율이나 NVIDIA 성능·사용자 시간 절감으로 표현하지 않는다.

중간 위험도 3건은 mammoth의 argparse/sprintf-js 전이 의존성 관련 보고다. audit가 제안한 오래된 mammoth로의 강제 변경은 적용하지 않았다. 현재 버전과 관찰 결과를 기록하며, 취약점이 없다고 주장하지 않는다.

세부 로그와 fixture 원자료는 `data/runtime/hackathon-cleanup-2026-10-07/` 및 `data/runtime/benchmarks/2026-10-07T09-10-39-289Z.*`에 보관한다. fixture와 HTTP mock을 실제 Nebius 호출 증거로 사용하지 않는다.

## 검토용 소스 묶음

`npm run package:source`를 실행해 현재 앱·테스트·더미 데이터·현재 안내의 소스 파일 291개를 `data/runtime/submission/ActFlow-Nebius-NVIDIA-Review-Source.zip`에 묶었다. `.env.local`, runtime DB, 암호화 키, node_modules, 이전 소스 복사본·ZIP, history와 로컬 모델 자료는 포함하지 않는다.

이 ZIP은 검토용이다. 공개 저장소·라이선스·실 계정 접속·심사 접근 경로가 준비됐다는 의미는 아니다. 기존 작업과 이번 기여의 날짜는 README에 명시했다.

## 전체 제품 개편의 남은 항목

실 Nebius 크레딧·모델 접속·JSON 응답 품질, 일반 업무의 Goal Contract와 원문 사실 검증, 이미 확정한 모든 단계의 보상 복구, 실제 메일 원격 검증, 운영 인증과 상시 원격 worker, 사용자 관찰, 영어 영상 및 공개 저장소·라이선스·심사 접근 경로가 남았다. 교육 파일의 검증 전 임시 상태와 검증 후 확정은 이번에 구현했다.

100점이나 수상을 보장하지 않는다. 필수 기술을 실제로 사용했다는 계정 기반 증거와 정상·실패·복구 흐름의 검증 자료를 쌓아 심사할 수 있는 제품으로 만드는 것이 기준이다.
