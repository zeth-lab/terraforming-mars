# 카드 데이터 (data/cards.json)

테라포밍 마스 기본판 + 대기업시대(Corporate Era) 프로젝트 카드 208장과 기업 카드
(초보자용 포함)를 구조화한 JSON입니다. 추후 "카드 검색 → 각 기호(아이콘)마다 3D
애니메이션을 순서대로 재생"하는 기능에 쓰기 위해, 카드에 표시되는 기호를 **카드에
나온 순서 그대로** `effects` 배열의 "원자(atom)"로 분해했습니다.

## 출처

- 코드/데이터 출처: [terraforming-mars/terraforming-mars](https://github.com/terraforming-mars/terraforming-mars)
  (GPL-3.0 라이선스)의 카드 정의 TypeScript 소스(`src/server/cards/...`)와
  한국어 로케일 파일(`src/locales/ko/*.json`).
- **이 저장소의 코드(게임 로직, 렌더러 구현)는 복사하지 않았습니다.** `tools/extract_cards.mjs`는
  TypeScript 컴파일러의 파서로 카드 정의 파일의 AST를 읽어, 카드 생성자에 전달되는
  속성 객체(`type`, `name`, `tags`, `cost`, `requirements`, `behavior`, `action`,
  `victoryPoints`, `metadata.cardNumber`, `metadata.description`)와
  `metadata.renderData`(카드에 그려지는 기호를 순서대로 쌓는 fluent 빌더 호출 체인)를
  정적으로 분석해 **데이터만** 뽑아, 이 프로젝트 고유의 스키마로 다시 표현합니다.
  렌더러 클래스(`CardRenderer`)나 게임 엔진 로직은 import하거나 실행하지 않았고,
  메서드 호출 체인(`b.production(pb => pb.steel(1))` 등)을 AST 그대로 펼쳐서
  "어떤 메서드가 어떤 인자로, 어떤 순서로 호출되는지"만 읽어냅니다.

## 범위

- 프로젝트 카드 208장 (기본판 137장 + 대기업시대 71장 = 208장, 전수 확인됨)
- 기업 카드 13장 (`BASE_CARD_MANIFEST.corporationCards` 11장[초보자용 포함] +
  `CORP_ERA_CARD_MANIFEST.corporationCards` 2장[새턴 시스템, 테렉터])

  > **참고**: 작업 지시에는 "기업 카드 17장"이라고 되어 있었으나, 실제
  > `StandardCardManifests.ts`의 `BASE_CARD_MANIFEST` + `CORP_ERA_CARD_MANIFEST`에
  > 등록된 기업 카드는 13장(실물 기본판 상자의 기업 12종 + 초보자용 기업 1종)뿐입니다.
  > 나머지 4장(로빈슨 인더스트리, 밸리 트러스트, 비토르, 셀레스틱 등 프로모 기업)은
  > 이 코드베이스에서 `promo`/`turmoil` 등 별도 확장 모듈로 분류되어 있어
  > "기본판+대기업시대" 범위 밖입니다. 과소 추출이 아니라 매니페스트 전수 조사로
  > 확인한 실제 숫자이며, 프로모 기업까지 포함하려면 범위를 넓혀 재실행하면 됩니다
  > (아래 "재실행 방법" 참고).

## 스키마 (`data/cards.json`, 카드 1장 = 객체 1개)

```json
{
  "num": "056",
  "ko": "광산",
  "en": "Mine",
  "kind": "project",
  "color": "green",
  "cost": 4,
  "corporateEra": true,
  "tags": ["building"],
  "req": null,
  "effects": [{"atom": "prod", "res": "steel", "n": 1, "any": false}],
  "vp": null,
  "ko_text": "강철 생산력 1 증가.",
  "en_text": "Increase your steel production 1 step.",
  "needs_manual": false,
  "note": "",
  "search": "광산 Mine gwangsan ㄱㅅ 056 mine"
}
```

필드:

- `num`: 카드 번호. 프로젝트 카드는 `"001"`~`"208"` 3자리, 기업 카드는 원본의
  `R00`, `R08` 같은 코드를 그대로 둠(카드 매수가 적어 별도 포맷이 쓰임).
- `ko`/`en`: 한글/영문 카드명.
- `kind`: `"project"` | `"corporation"`.
- `color`: `"green"`(자동, AUTOMATED) | `"blue"`(능동, ACTIVE) | `"red"`(사건, EVENT) | `"corp"`(기업).
- `cost`: 프로젝트 카드 비용(M€). 기업 카드는 `null`.
- `corporateEra`: 대기업시대 전용 카드 여부(모듈이 `corpera`인지).
- `tags`: 소문자 태그 배열.
- `req`: 플레이 조건. `{"type":..., "value":..., "max":bool, ...}` 또는 `null`.
  조건이 여러 개면 배열.
- `effects`: 카드에 표시된 기호를 **원문 순서 그대로** 분해한 원자 배열.
  원자 종류와 필드는 `data/atoms.md` 참고.
- `vp`: 승점. `{"type":"fixed","value":N}` / `{"type":"per_resource"|"per_tag"|"per_tile","value":N,"per":N,"of":...}` / `{"type":"special","value":null}` / `null`.
- `ko_text`/`en_text`: 카드 설명 전문(가능하면 원문 `metadata.description`, 없으면
  렌더링 텍스트 조각들을 순서대로 이어붙인 것).
- `needs_manual`: 자동 추출이 애매했던 카드 표시. 목록은 `data/manual.md`.
- `note`: `needs_manual`인 이유(여러 개면 `; `로 구분).
- `search`: 검색용 문자열(한글명 + 영문명 + 로마자 표기 + 초성 + 번호 + 공백 없는 영문).
- `startingMegaCredits`: **기업 카드에만** 추가된 필드(스키마에 없던 보강 필드).
  시작 자금이 기업 카드의 핵심 정보라 포함했습니다.

## 원자(atom) 어휘

작업 지시의 어휘를 그대로 사용했고, 매핑이 안 되는 것만 `{"atom":"text","en":...,"ko":...}`로
떨어뜨리고 해당 카드를 `needs_manual: true`로 표시했습니다. 실제 등장한 원자 종류·개수·예시는
`data/atoms.md`에 표로 정리했습니다(10종: `prod`, `gain`, `global`, `tr`, `tile`, `draw`,
`card_res`, `action`, `effect`, `discount`, 그리고 fallback인 `text`).

## 추출 방법 (요약)

1. `tools/extract_cards.mjs`가 `StandardCardManifests.ts`를 파싱해 어떤 카드가
   `base`/`corpera` 모듈, `project`/`corporation` 종류로 등록되어 있는지, 어떤 파일에
   구현되어 있는지 알아냅니다.
2. 각 카드 파일을 TypeScript 컴파일러로 파싱해 생성자의 `super({...})` 호출 인자를
   AST 그대로 평가합니다(`Tag.BUILDING` 같은 enum 접근은 `Tag.ts` 등에서 직접 파싱한
   작은 맵으로 치환). 평가하지 못한 노드는 `{__unresolved}` 마커로 남기고 해당 카드를
   `needs_manual`로 표시합니다.
3. `metadata.renderData: CardRenderer.builder((b) => { ... })` 안의 메서드 체인
   (`b.production(...)`, `b.effect(...)`, `b.action(...)` 등)을 AST에서 그대로
   펼쳐 호출 순서를 유지한 `{method, args}` 목록으로 만들고, 이를 `atom` 어휘로
   매핑합니다. **렌더러 클래스는 실행하지 않습니다** — 메서드 호출 트리만 읽습니다.
4. 한국어는 `src/locales/ko/*.json`을 전부 병합한 사전에서, 카드가 실제로 쓰는
   영문 문자열(이름, `description`, `effect()`/`action()`의 설명 문자열 — 실제
   앱은 `"Effect: " + text` / `"Action: " + text` 형태로 키를 만들길래 그 접두사도
   먼저 시도)을 그대로 키로 찾아 가져옵니다.
5. `requirements`/`victoryPoints`/`cardDiscount`는 선언적 필드를 직접 스키마로
   변환합니다(렌더링과 무관하게 항상 정확).

## 재실행 방법

```bash
# 1) 원본 저장소를 필요한 디렉터리만 sparse-checkout으로 받기
mkdir tm-src && cd tm-src
git clone --depth 1 --filter=blob:none --sparse \
  https://github.com/terraforming-mars/terraforming-mars.git .
git sparse-checkout set \
  src/server/cards src/common/cards src/locales/ko \
  src/server/behavior src/common/TileType.ts src/server/boards/PlacementType.ts \
  src/common/Resource.ts src/common/CardResource.ts src/common/GlobalParameter.ts \
  src/common/cards/Types.ts src/common/cards/TRSource.ts \
  src/common/cards/render/CardRenderDescription.ts src/common/cards/render/CardRenderItemType.ts \
  src/server/cards/Options.ts src/server/cards/render
cd ..

# 2) 추출 스크립트 실행 (Node 18+, typescript 패키지 필요)
node tools/extract_cards.mjs --src ./tm-src --out data
```

프로모/다른 확장까지 범위를 넓히려면 `tools/extract_cards.mjs`의 `parseManifests()`가
읽는 매니페스트 상수 이름(`BASE_CARD_MANIFEST`, `CORP_ERA_CARD_MANIFEST`)에 다른
모듈(`PromoCardManifest.ts` 등)을 추가하면 됩니다.

## 검증 결과

- ✅ 프로젝트 카드 208장 전수 확인 (기본판 137 + 대기업시대 71).
- ✅ 기업 카드 13장 전수 확인 (기본판 11[초보자용 포함] + 대기업시대 2).
- ✅ 카드 번호(`num`) 중복 없음.
- ✅ 한국어 이름(`ko`) 누락 0건 (221장 전부).
- ⚠️ `needs_manual: true` 10장(4.5%) — 목록과 사유는 `data/manual.md`. 전부 원문 카드가
  가변 수치(X칸), OR 선택형 레이아웃, 위 첨자 주석(상환 수단 대체 표시) 등 자유 형식
  렌더링을 쓴 경우로, 기계적 매핑 실패가 아니라 "이 카드는 사람이 한 번 봐야 한다"는
  정직한 표시입니다.

### 무작위 10장 원문 대조

아래 10장을 원본 TypeScript 소스 및 실제 카드 텍스트와 1장씩 직접 대조했습니다.
이 과정에서 버그 2건을 발견해 스크립트를 수정했고(아래 표의 "조치" 열), 현재
`data/cards.json`에는 수정된 결과가 반영되어 있습니다.

| 번호 | 카드명 | 대조 결과 | 조치 |
|---|---|---|---|
| 056 | 광산 (Mine) | `effects`/`req`/`vp`/텍스트 모두 원문과 일치 | - |
| 072 | 새 (Birds) | 행동(동물 자원 추가) + 조건부 생산 감소 + VP(자원당 1점) 모두 일치 | - |
| 136 | 대형 댐 (Great Dam) | 해양 4장 조건, 에너지 생산 +2, VP 1 모두 일치 | - |
| 040 | 소행성 채굴 (Asteroid Mining) | 티타늄 생산 +2, VP 2 일치 | - |
| 008 | 수도 (Capital) | 해양 4장 조건, 에너지 -2/M€ +5, 타일 배치, 인접 해양당 VP 1 모두 일치 (생성자 매개변수 기본값 패턴이라 별도 처리 필요했음) | - |
| 045 | 원자력 발전 (Nuclear Power) | **버그 발견**: M€ 생산 변화가 `+2`로 잘못 추출됨 (원문은 `.minus().megacredits(2)`처럼 부호를 별도 `minus()` 심볼로 표시하는 구식 작성법이었는데, 이를 무시하고 있었음) | `minus()` 심볼을 뒤따르는 수치에 음수로 접어주는 전처리 추가 → `-2`로 수정 확인 |
| 012 | 유로파에서 물 수입 (Water Import From Europa) | **버그 발견**: "티타늄도 결제 수단으로 쓸 수 있음"을 나타내는 위 첨자 주석(`.super(...)`)이 별도 결제 비용(+1 티타늄)으로 잘못 합산됨 | 위 첨자 주석은 비용에 합산하지 않고 `needs_manual`로 분리 표시하도록 수정 |
| R08 | 크레디코르 (CrediCor) | 시작 자금 57, "20M€ 이상 결제 시 4M€ 획득" 지속 효과 일치 | - |
| R30 | 테렉터 (Teractor) | 시작 자금 60, 지구 태그 할인 3(declarative `cardDiscount`) + 동일 내용의 렌더링 기반 `effect` 원자가 중복 생성됨(의도된 동작: 선언적 필드와 렌더링 기반 원자가 같은 효과를 두 가지로 표현) | 중복은 버그가 아니라 설계상 허용된 중복으로 문서화 |
| 073 | 화성 대학교 (Mars University) | 과학 태그 사용 시 "버리고 뽑기" 효과, VP 1 모두 일치. `effect()` 설명 문자열의 한국어 번역이 처음엔 안 잡혔음(실제 앱은 `"Effect: " + text`를 번역 키로 사용) | `"Effect: "`/`"Action: "` 접두사를 붙여 먼저 조회하도록 수정 |

## 알려진 한계

- `effects`는 **보이는 기호의 순서**를 최대한 보존하지만, 일부 카드는 OR 선택형
  레이아웃이나 위 첨자 주석처럼 선형 시퀀스로 완벽히 표현되지 않는 레이아웃을 씁니다.
  이런 카드는 `needs_manual: true`로 표시되어 있습니다(`data/manual.md`).
- 기업 카드 대부분은 지속 효과를 `onCardPlayed` 같은 TypeScript 메서드로 직접
  구현하지만(선언적 `behavior`/`action` 필드가 아님), 렌더링 데이터(`metadata.renderData`)에는
  해당 효과의 기호가 그대로 나오기 때문에 대부분 정상적으로 추출됩니다. 렌더링 데이터조차
  없는 극소수 카드만 비어있는 `effects`로 남고 `needs_manual: true`가 됩니다.
