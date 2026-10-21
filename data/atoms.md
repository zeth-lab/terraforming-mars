# 원자(atom) 종류별 통계

생성: `tools/extract_cards.mjs` 실행 결과. 전체 카드 221장에서 발견된 원자 종류와 등장 횟수, 예시 카드 3장씩.

| atom | 개수 | 예시 카드 |
|---|---|---|
| prod | 179 | 048 개량종 지의류 (Adapted Lichen); 170 암모니아 소행성 대기권제동 소각 (Aerobraked Ammonia Asteroid); 047 조류 (Algae) |
| gain | 118 | 187 지하수 개발 (Aquifer Pumping); 047 조류 (Algae); 023 극지 미세조류 (Arctic Algae) |
| tile | 43 | 187 지하수 개발 (Aquifer Pumping); 116 인공 호수 (Artificial Lake); 022 흑색 분말 (Black Polar Dust) |
| card_res | 41 | 170 암모니아 소행성 대기권제동 소각 (Aerobraked Ammonia Asteroid); 035 개미 (Ants); 072 새 (Birds) |
| text | 38 | 153 적응기술 (Adaptation Technology); 187 지하수 개발 (Aquifer Pumping); 072 새 (Birds) |
| effect | 34 | 153 적응기술 (Adaptation Technology); 023 극지 미세조류 (Arctic Algae); 131 분해자 생물 (Decomposers) |
| action | 31 | 035 개미 (Ants); 187 지하수 개발 (Aquifer Pumping); 015 적도 자기장 생성기 (Equatorial Magnetizer) |
| global | 18 | 009 소행성 (Asteroid); 011 대형 소행성 (Big Asteroid); 010 혜성 (Comet) |
| draw | 13 | 161 유로파 수송선단 (Convoy From Europa); 143 대규모 수송선단 (Large Convoy); R00 초보자용 기업 (Beginner Corporation) |
| tr | 12 | 015 적도 자기장 생성기 (Equatorial Magnetizer); 163 질소 수입 (Imported Nitrogen); 171 자기장 돔 (Magnetic Field Dome) |
| discount | 10 | 020 연구 전진기지 (Research Outpost); 166 왕복선 (Shuttles); R13 토르게이트 (ThorGate) |

## 필드 설명

- `prod` / `gain`: `res`(mc/steel/titanium/plant/energy/heat), `n`(증감량), `any`(아무 플레이어 대상 여부), `per`(있으면 "n당 1회" 배수/태그 조건)
- `global`: `param`(temperature/oxygen/venus), `n`
- `tr`: `n`
- `tile`: `tile`(ocean/greenery/city/special 등), `n`(개수), `where`
- `draw`: `n` (음수면 카드 버리기)
- `card_res`: 카드 위 자원(동물/미생물/과학 등). `res`, `n`, `target`(this/any)
- `action`: 파란 카드 행동. `cost`(원자 배열), `gain`(원자 배열)
- `effect`: 지속 효과(빨간/파란 테두리). `trigger`(한국어 설명 문자열), `result`(원자 배열)
- `discount`: 카드 할인. `n`, `tag`, `per`
- `text`: 위 원자로 표현하지 못한 텍스트/아이콘. `en`, `ko`
