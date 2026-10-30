# ActFlow 제출·시연 플레이북

2026-10-23 갱신: 현재 실행·검증 상태는 [새 릴리스 보고서](2026-10-23-release.md), 심사 재현 안내는 [영문 리뷰 가이드](JUDGE_GUIDE.md)를 먼저 따른다. 예제 기한을 2026-11-20으로 갱신했고, 예제→지속 작업 시작, 검색·상태 필터, 실행별 완료 근거 연결, 검증 요약 저장, 24개 합성 검증 사례를 추가했다. 아래 실모델·Gmail·사용자 영향력 관련 목표 대본은 실제 확인 후에만 사용한다.

작성: 2026-10-07, 업데이트: 2026-10-11, Asia/Seoul. [현재 상태 분석](2026-10-07-actflow-hackathon-review.md), [제품 개편 제안](actflow-product-proposal.md)의 제출용 실행 기준이다. 아래 영어 피치는 **목표 기능을 구현·검증한 뒤 사용할 초안**이다. 현재 빌드에서 미구현인 동작을 녹화·제출 문구로 주장하지 않는다.

## 1. 심사위원에게 남길 메시지

**ActFlow completes work with evidence.**

처음에는 사용자의 문제를 보여준다. 중간에는 도구가 성공을 반환했지만 업무 결과가 틀린 상황을 보여준다. 마지막에는 실제 복구·재계획·승인·외부 결과 확인·지속 업무를 보여준다.

‘승인 버튼이 있다’, ‘메일을 쓴다’, ‘기억한다’는 개별 기능 소개를 중심으로 두지 않는다. 단일 업무에서 완료 조건과 실제 결과를 연결하는 것이 핵심이다.

## 2. 영어 제출 설명 초안

**Title:** ActFlow

**Tagline:** Work completed with evidence.

**Inspiration**

Small operations teams coordinate training registrations and recurring submissions across documents, approvals, and email. Generating a file is only part of the job. Someone still has to check the participants, protect private data, approve the exact message, and follow up when the next reply arrives.

**What it does — target release description**

ActFlow keeps each request as a persistent task with explicit completion conditions. It proposes a plan, checks the user's action boundaries, stages local changes, and independently inspects the results. Failed checks trigger recovery of supported changes and a bounded replan. External actions require the appropriate authorization and separate result confirmation. The task can wait for a reply and continue with its original goal and evidence.

**How it is built — publish only after real integration**

NVIDIA Nemotron served through Nebius Token Factory generates plans and revises them using verification failures and new events. A TypeScript runtime enforces policy, executes registered tools, verifies artifacts, records changes and approvals, and preserves tasks and events in SQLite. Model suggestions do not grant permissions or establish completion.

**What makes it useful**

Our demonstration follows a training submission from document preparation to an authorized external reply and follow-up. A deliberately incorrect spreadsheet receives a successful tool response, but ActFlow rejects it against the declared completion conditions. The user can inspect the failed condition, recovery evidence, corrected result, and continuing task.

**Boundaries**

Recovery covers supported reversible changes. Already-sent email is not undoable. An uncertain external result pauses the task for reconciliation instead of blind retry. Worker availability determines when background processing runs.

현재 실행본에는 고정 Nebius endpoint의 NVIDIA adapter, 소유자별 키·모델 설정, 서버 추론 영수증, 교육 파일의 구조·값 검증, 검증 후 확정과 임시 파일 복구가 있다. 10월 11일에 계정 인증, Gmail REST 연결·SENT 확인, Goal Contract, 지원 파일의 이전 확정 결과 복구와 제한된 재계획, 배포 패키지를 추가했다. 실 Nemotron·Gmail 계정 검증은 설정 전이다. 위 목표 피치는 이 차이를 반영한 뒤 녹화한다.

**Current review release — accurate description**

ActFlow stores work as a Living Task and enforces policy and approval before execution. For its training-submission workflow, it verifies exact participant rows, generated response counts and costs, and file hashes before committing staged artifacts. It records failed checks and the actual cleanup result, including files that could not be removed. The live inference path is restricted to NVIDIA models through Nebius Token Factory. Current automated evidence uses deterministic fixtures and mocked HTTP; real account access and model quality remain unverified. The Gmail connector, account authentication, goal completion contract and bounded compensation/replanning are implemented. Live Gmail/Nebius account validation remains pending. Background processing requires the Node worker to remain available.

## 3. 2분 55초 영상 구성과 영어 내레이션

공식 안내는 3분 안에 문제·대상·작동하는 결과·Nebius/NVIDIA 사용을 전달하고, 필수 기술을 음성으로 명확히 설명하도록 권한다. 현재 폴더의 메뉴·설정 안내 중심 대본은 사용자 도움말로 남기고 별도의 피치를 만든다. [공식 제작 안내](https://nebiusglobalaihackathon.devpost.com/updates/46205-how-to-build-a-winning-project)

| 구간 | 실제 화면에서 보여줄 것 | 핵심 증거 |
|---|---|---|
| 0:00–0:15 | 사용자의 교육 제출 요청과 확인 부담 | 누구의 어떤 문제인지 |
| 0:15–0:35 | 목표와 완료 조건, 실제 계획 | Nebius/NVIDIA 실 호출·원문 근거 |
| 0:35–1:05 | 고장 주입 XLSX: 도구 성공→검증 실패→임시 복구 | 필수 열·대상 행, 실패 조건, 파일 복구 |
| 1:05–1:25 | Nemotron 재계획·정상 결과·수신자 경계 | 같은 목표 조건 유지·독립 재검사 |
| 1:25–1:50 | 정확한 내용 승인·실메일·원격 결과 | 승인에 결합한 내용과 실제 message ID |
| 1:50–2:20 | 대기→브라우저 종료→worker 재시작→답장 Wake | 동일 Task ID·새 episode·중복 방지 |
| 2:20–2:45 | 전체 조건과 근거·실측 결과 | 실제 완료와 측정 범위 |
| 2:45–2:55 | 제품 가치와 명확한 복구 한계 | 짧은 마무리 |

### 0:00–0:15

“A file was created. But were the right people included? Was private data excluded? Did the submission reach the right place? For operations teams, checking the work can take as much attention as doing it.”

### 0:15–0:35

“This is ActFlow. I ask it to prepare a training submission and follow it through. NVIDIA Nemotron running on Nebius Token Factory proposes the plan. ActFlow records what must be true before this task can be called complete.”

### 0:35–1:05

“Here, we deliberately return a bad spreadsheet from a successful tool call. The names appear in a note, but the required columns and participant rows are missing. ActFlow checks the actual file, rejects the result, and removes the staged files. These records show what failed and what was recovered.”

### 1:05–1:25

“Nemotron receives the failed checks and revises the plan without changing the goal. The corrected file now matches the source records. A changed email address cannot reuse the same authorization. The policy applies to the exact recipient and the exact attachment.”

### 1:25–1:50

“I review this recipient, message, and attachment, then approve that specific action. ActFlow sends through our connected test account and reads the remote result back. It records the confirmed action separately from the external party's acknowledgment.”

### 1:50–2:20

“The task is now waiting, so it is not marked complete. We close the browser and restart the worker. When the reply arrives, the same task continues with its original goal and evidence. Replaying the same event does not send the message again.”

### 2:20–2:45

“Each completed condition has supporting evidence. Our evaluation reports valid completion, false completion, recovery, duplicate actions, and the human effort needed for normal work. We compare the same model and inputs in an isolated test environment.”

### 2:45–2:55

“ActFlow completes work with evidence. It recovers supported changes and keeps the next step accountable.”

자막과 편집은 실제 기능을 대신할 수 없다. 녹화할 때는 실제 말하기 속도에 맞춰 대본을 줄인다.

위 문장은 영어 피치의 목표 대본이다. 측정·실메일·복구·재시작을 실제로 확인하지 못하면 해당 문장을 삭제하거나 검증 범위를 설명하는 문장으로 바꾼다.

녹화 원칙:

- 고장 주입은 눈에 보이는 라벨로 표시한다. 실제 고객 사고나 자연 발생 오류처럼 연출하지 않는다.
- 기다리는 구간을 편집하면 시간 점프를 표시한다. 수분의 기다림을 ‘3일 후 검증’이라고 하지 않는다.
- 실모델 호출 증거와 모델 ID를 보여주되 키·원문 민감정보는 가린다.
- 실메일은 소유·통제하는 테스트 계정 사이에서 실행한다. SIMULATED는 계속 명확히 표시한다.
- UI의 완료 조건, 실물 파일, 원격 조회 결과가 맞는지 별도로 점검한다.
- 실제 participant 데이터를 사용하지 않고 더미 데이터로 시연한다.
- 기존 샘플의 업무 기한은 10월 20일이다. 이후 녹화에서는 미래 기한을 가진 새 더미 문서를 사용하고, 원문과 결과의 날짜가 일치하는지 검사한다. 지난 기한을 정상 제출처럼 보여주지 않는다.

## 4. 평가 설계

현재 Demo 벤치마크는 고정 교육 샘플과 로컬 도구 검증이다. 일반 요청 이해·Nebius 모델 성능·현실의 작업 완료율로 확장해서 주장하지 않는다.

추천 첫 평가 세트는 **24개 서로 다른 사례**다. 반복 실행 횟수와 서로 다른 사례 수를 별도로 기록한다.

| 묶음 | 개수 | 포함할 사례 |
|---|---:|---|
| 정상 업무 | 8 | 적법한 명단·회신, 승인 경계, 다른 기한·대상 인원, 정상 새 답장 |
| 결과 오류 | 6 | 이름만 메모에 있음, 필수 열 누락, 중복 ID, 잘못된 대상, 문서 인원 불일치, 잘못된 비용 |
| 정책·데이터 경계 | 6 | 한 글자 다른 주소, Reply-To 변경, 비밀정보, 다른 작업 첨부, 승인 뒤 첨부 변경, 정책 철회 |
| 지속 업무·복구 | 4 | 중복 event, 승인 중 event 보관, 단계 중단·재시작, 결과 불명확한 전송 |

도구·DB 고장 검사는 결정적 fixture로 먼저 수행한다. 실 모델 평가는 확인된 크레딧 범위에서 시작하고 실제 호출 수·token usage·실패를 기록한다. 허용 예산을 모르는 상태에서 전체 반복 실행 비용을 가정하지 않는다.

대조 실험은 같은 모델·원문·도구와 동일한 oracle을 사용한다. 한쪽은 ActFlow의 조건·검증·복구 경로, 다른 쪽은 최소 도구 실행 loop다. 비교 경로는 격리된 workspace와 합성 transport에서만 실행한다. 실제 계정의 보호를 꺼서 위험 행동을 측정하지 않는다. 이 대조는 경쟁 제품 전체의 성능 비교가 아니다.

독립 oracle은 원본 fixture의 대상 ID·기한·금액·수신자·파일 구조·외부 상태로 결과를 판정한다. 앱의 녹색 상태나 같은 verifier 반환값을 정답으로 사용하지 않는다.

| 지표 | 정의 | 해석할 때 주의할 것 |
|---|---|---|
| 유효 완료율 | 독립 oracle과 정책을 모두 만족한 완료 / 정상 사례 | 전부 HUMAN_ONLY이면 자동화 성공이 아님 |
| 잘못된 완료 | 실패 조건인데 완료로 표시한 사례 / 오류 사례 | 0/N은 해당 세트의 결과이며 일반 무오류 보증이 아님 |
| 복구 성공 | 지원 범위의 변경을 실제 복원한 사례 / 보상 대상 사례 | 재계획 성공과 복구 성공은 별도 |
| 중복 외부 행동 | replay 뒤 원격 효과 수가 기대보다 늘어난 사례 수 | provider 조회 증거와 함께 측정 |
| 과도한 차단 | 정책상 허용인데 불필요하게 중단한 정상 사례 / 허용 정상 사례 | 안전성만 높이고 쓸 수 없게 만들지 않기 |
| 사용자 부담 | 정상 완료 1건당 확인 수·수정 수·능동 작업 시간 | 단순 승인 개수보다 실제 노력 측정 |
| 속도·비용 | p50/p95 처리 시간, 모델 호출·token usage | 사람·외부 대기 포함/제외 경계를 명시 |

원자료에는 case ID, goal version, input hash, model ID, 실제/합성 실행 구분, attempt, 정책 결과, tool 결과, verifier 결과, oracle 결과, effect ID, 복구 결과, 시간, token usage, 오류를 남긴다. 한 번의 모델 측정으로 품질이 안정적이라고 단정하지 않는다.

## 5. 영향력 증거

운영 담당자 3–5명에게 실제 반복 업무 하나를 관찰한다. 수행 중인 업무의 원문을 무단으로 확보하지 않고 더미로 재현할 수 있는 구조만 기록한다.

비교할 것:

- 수동 준비와 확인에 쓴 능동 시간.
- 누락·틀린 수신자·잘못된 값 때문에 다시 작업한 횟수.
- ActFlow가 완료한 정상 단계와 사람이 손댄 단계.
- 원하는 행동 경계와 승인 문구를 이해할 수 있는지.
- 다시 사용할 의향과 이유. 단순한 ‘좋다’ 평가는 구체적인 성공 증거가 아니다.

절감률·월간 비용·기업 채택 수는 실제 기록이 생긴 뒤 작성한다. 현재는 사용자와 문제의 가설이며 고객 인터뷰나 판매가 완료된 상태가 아니다.

## 6. 예상 심사 질문과 준비할 답

| 질문 | 답변 방향 | 보여줄 증거 |
|---|---|---|
| 승인 기능은 다른 Agent에도 있지 않나요? | 개별 기능의 최초 발명을 주장하지 않고 목표·검증·복구·지속 업무의 통합을 설명 | 하나의 실패→수정→실행 흐름 |
| 모델이 자기 결과를 검사하는 건가요? | 파일·원격 상태를 별도 코드로 검사, 의미가 모호하면 미확정 | 잘못된 파일의 구체적 검사 실패 |
| 이미 보낸 메일도 취소하나요? | 취소를 보장하지 않음, irreversible 경계 전에 검증·승인 | 전송 단계와 복구 범위 표시 |
| 그냥 아무 일도 안 하면 안전한 것 아닌가요? | 정상 업무 유효 완료와 사람 부담도 함께 평가 | 정상 세트 완료·과도한 차단 지표 |
| 왜 NVIDIA/Nebius가 필요한가요? | 실제 문서 계획·오류 근거를 사용한 재계획·새 사건 계획에 사용 | 실제 모델 response와 새 계획 연결 |
| 채팅을 닫으면 어떻게 되나요? | 브라우저와 별개 worker·영속 상태, worker 중단 때의 한계 설명 | 재시작 후 같은 Task ID |
| 보안이 완벽한가요? | 지원된 경계·검증·공백을 정확히 설명 | 비밀정보·다른 소유자·전송 불명확 상태 |
| 기존 프로젝트를 제출한 건가요? | 실제 시점과 대회 기간 중 기여를 Git·문서로 설명 | 기준 commit과 구현 변경 |

## 7. 제출과 접근 준비 체크리스트

공식 요구의 전체 내용과 근거는 [분석 문서의 규정 표](2026-10-07-actflow-hackathon-review.md#2-공식-규정에서-먼저-확인할-것)에 있다. 아래는 이를 실행하기 위한 작업 목록이다.

- [x] 루트를 대회용 기준 실행 소스로 통합한다. 폴더 안 검토본·구형 ZIP은 실행·검토 ZIP에서 제외한다.
- [ ] 제출 시점의 tagged commit을 정한다. 현재 구현은 작업 트리의 변경이다.
- [x] 고정 의존성 설치와 자동 검증 절차를 준비했다. 10월 11일의 실제 검사 결과와 범위는 [최신 보고서](2026-10-11-release.md)를 따른다.
- [x] 영어 README에 최소 설정, 실행·테스트·한계·NVIDIA/Nebius 경로와 fixture의 범위를 안내한다.
- [x] 소스에 MIT LICENSE를 추가했다. 공개 저장소 URL 발행은 아직 진행하지 않았다.
- [ ] URL 하나에서 demo 또는 test build를 받을 수 있게 준비한다. 공개 여부·발행은 준비 결과를 검토한 후 결정한다.
- [ ] 실 모델을 심사자가 시험할 경로에 본인의 유료 키 입력을 요구하지 않도록 준비한다. 제공 크레딧에는 요청 제한을 둔다.
- [x] 운영 모드에서 계정 로그인을 요구하고 데모 인증·fixture를 차단한다. 실제 서버와 심사용 계정은 [배포 안내](../DEPLOYMENT.md)에 따라 설정한다.
- [ ] 접근이 제한돼 있으면 심사용 계정과 영어 testing instructions를 준비한다.
- [ ] 영상·설명·실행판이 같은 기능을 보여주도록 맞춘다.
- [ ] 실제/합성 호출, 확인/미확인 결과와 실행 한계가 분명한지 검사한다.
- [ ] 원문·credential·runtime DB·개인 파일이 공개 source/ZIP/video에 포함되지 않도록 점검한다.
- [ ] 주제와 관련 없는 타사 상표·음악·자료를 사용하지 않는다.
- [ ] Nebius/NVIDIA 사용 피드백을 실제 관찰로 작성한다.
- [ ] 제출을 10월 30일 한국 낮에 완료할 목표로 운영한다.
- [ ] 심사 종료까지 URL과 실행판이 유지되는 책임·비용을 정한다.
- [ ] 실메일 OAuth·refresh token의 만료·철회·재인증 경로를 검증한다. 외부 Testing 앱의 7일 만료 조건 등은 [Google 공식 OAuth 안내](https://developers.google.com/identity/protocols/oauth2)로 확인한다.

여기에서 공개 배포는 선택 가능한 접근 방식이며 필수라고 추가 주장하지 않는다. 작동하는 test build URL도 사용할 수 있다. 다만 실 모델 비용·인증·실행 편의성을 포함해 심사자가 실제로 평가할 수 있어야 한다.

## 8. Nebius/NVIDIA 피드백 기록 방식

온보딩: 계정 생성→첫 모델 호출까지 실제 단계·문제·소요 시간을 기록한다.

API: 사용한 endpoint와 모델 ID, JSON/tool calling 호환, timeout/rate limit, 오류 메시지와 해결 과정을 기록한다.

모델: 문서의 근거 보존, 계획 구조, 오류 뒤 재계획, 불확실성 처리에서 실제 사례를 기록한다.

제품 의견: 잘된 점, 필요한 개선, 재현 가능한 정보, 다시 사용할 이유를 적는다. 키·민감 원문을 붙이지 않는다. 사용하지 않은 AI Cloud·NemoClaw 도구를 사용한 것처럼 평가하지 않는다. [공식 피드백 안내](https://nebiusglobalaihackathon.devpost.com/updates/46205-how-to-build-a-winning-project)

## 9. 보너스 상과 집중할 범위

Tavily는 업무에 최신 외부 근거가 꼭 필요한 경우에만 고려한다. 이번 명단·회신 업무에 억지로 검색을 넣으면 제품과 증거가 복잡해진다. 도시상은 해당 오프라인 행사의 실제 참석 조건을 확인한 경우에만 노린다. 기능 우선순위를 보너스 상에 맞춰 바꾸지 않는다. [공식 상 안내](https://nebiusglobalaihackathon.devpost.com/#prizes)

## 10. 이번 작업 완료와 남은 작업

완료한 구현과 검사 결과는 [10월 11일 릴리스 보고서](2026-10-11-release.md)에 기록한다. 10월 7일 보고서는 해당 시점의 이력이다.

남은 외부 단계: Nebius 크레딧·실 모델 품질 확인, Gmail OAuth 계정 연결·실제 발송 확인, 선택한 호스트에서 Docker/HTTPS·상시 worker 운영 확인, 사용자 관찰·실 모델 평가, 영어 영상 녹화·공개 저장소·심사 URL 발행과 최종 Devpost 제출. 제공 크레딧의 사용 범위는 계정에서 제한한다. 로컬 테스트 숫자를 실 모델 품질 측정이나 수상 점수로 환산하지 않는다.
