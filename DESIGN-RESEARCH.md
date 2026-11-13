# WINTER PALACE: RESONANCE — 디자인 리서치 레퍼런스

> 목적: 웹캠 모션 게임(포즈 따라 하기 → 과부하 차지 → 해방 스윙)의 게임 필·사운드·모션 UX·TV HUD·MediaPipe 구현에 바로 쓸 수 있는 구체 수치와 레시피를, 원문으로 검증한 출처와 함께 모은 문서.
> 작성: 2026-11-13. 표기 원칙 — **검증** = 원문 페이지를 직접 열어 확인. **미검증** = 검색 스니펫만으로 확인(인용 시 주의). "우리 게임 적용값" 중 출처에 없는 수치는 **자체 결정**으로 표기한다.

---

## 1. 게임 필 / 주스 (2D 액션)

### 1.1 고전 강연 3종의 실제 내용 — 수치는 거의 없다

**Jan Willem Nijman, "The Art of Screenshake" (Vlambeer, INDIGO 2013)** — 검증(전사본 대조)
- 영상: https://www.youtube.com/watch?v=AJdEqssNZ-U / 아카이브: https://archive.org/details/the-art-of-screenshake
- 전사: https://www.lcod.uk/til/game-feel/ , https://rpgplayground.com/blog/page/4/
- 30항목 체크리스트의 핵심: 기본 애니메이션+사운드 → 탄환 크게 → muzzle flash → impact effect(흔적 남기기) → 적 피격 애니메이션 → 넉백 → permanence(시체·탄피 잔류) → camera lerp → **screen shake** → recoil → **sleep(히트스톱)** → gun delay/kick → 사운드 베이스 강화 → 방향성 camera kick → 폭발 확대 → meaning(승패).
- **이 강연에는 hitstop ms·shake 픽셀·파티클 개수 같은 수치가 없다.** 유일한 정량 지침은 sleep에 대해 "1~몇 프레임 멈추되, 플레이어가 멈춤을 의식하기 직전(sweet spot)에 머물 것". 웹에 도는 "Nijman = sleep 20ms"는 전사에서 확인 안 됨 — **미검증, 인용 금지**.

**"Juice It or Lose It" (Jonasson & Purho, GDC Europe 2012)** — 검증(요약본)
- 영상: https://www.youtube.com/watch?v=Fy0aCDmgnxg
- 기법: tweening/easing, squash & stretch + wobble, screenshake, 화면 플래시, **파티클 — "너무 많다는 건 없다(You can't have too many particles)"**, 환경이 리듬에 반응. 수치 없음.

**Game Maker's Toolkit, "Secrets of Game Feel and Juice"** — 검증(자막 전문)
- https://software.ivertech.com/Videos/DisplayVideo.aspx?VideoID=7144
- 피격 인지: flash white + knockback + 애니메이션 변경 + 사운드를 총동원. 사운드는 베이스 강하게, **랜덤 피치로 반복감 제거**, 콤보 시 상승 피치(Mario/Peggle식). 수치 없음 — 개념 입문용.

### 1.2 Screen shake — 수학 모델 (Eiserloh, GDC 2016) — 검증(슬라이드 전문)

출처: Squirrel Eiserloh, "Math for Game Programmers: Juicing Your Cameras With Math" — https://archive.org/stream/GDC2016Eiserloh/GDC2016-Eiserloh_djvu.txt

- **Trauma 모델**: trauma ∈ [0,1]. 이벤트마다 **trauma += 0.2(소) 또는 0.5(대)**, 시간에 따라 선형 감쇠.
- **Shake 양 = trauma² 또는 trauma³** (trauma 0.3/0.6/0.9 → shake 3%/22%/73%, trauma³ 기준).
- 2D 구현: `angle = maxAngle × shake × noise`, `offsetX/Y = maxOffset × shake × noise`. random 대신 **Perlin noise** 권장 — 부드럽고 pause·슬로모션과 자동 호환.
- 변환+회전 동시 적용이 2D에서 가장 좋다("translational + rotational = Awesome").
- 카메라 추종 스무딩(Asymptotic Averaging): 매 프레임 목표까지 일정 비율 접근 — 가중치 **0.01=느림, 0.1=적당, 0.5=매우 빠름** (@60fps).

### 1.3 Hitstop / Flash / 넉백 — 실측 스펙표 — 검증

**GameDesignerX, "Hit Feedback in Frames"** (60fps 기준) — https://gamedesignerx.com/blog/hit-feedback-in-frames-designing-impact-with-hit-stop-shake-and-knockback

| 항목 | 시작값 |
|---|---|
| Hitstop — light | 2–3 프레임 (33–50ms) |
| Hitstop — medium | 4–6 프레임 |
| Hitstop — heavy/차지 | 8–12 프레임 |
| Hitstop — parry/퍼펙트 | 10–16 프레임 (+채도 저하·슬로모 램프) |
| Hitstop — killing blow | 12–20 프레임 (+카메라 푸시) |
| Hit flash | 타격 프레임 0부터 3–6 프레임, 흰색 또는 팔레트에 없는 핫컬러 |
| Shake 진폭 | 화면 높이 비율 — light 0.4%, 폭발 1.5%. 8–12 프레임에 걸쳐 0으로 감쇠. 동시 shake는 합산 후 clamp |
| 넉백 | light 0.25×캐릭터폭/회복 8f, heavy 1.0×폭/회복 20f |
| 오디오 | 타격음을 transient(crack)+body(thud)로 분리, **피치 ±5% 랜덤** |

주의: 공격자/피격자 freeze를 분리하고(피격자를 살짝 길게), **입력 버퍼는 절대 얼리지 말 것** — 얼리면 후속 입력이 씹혀 "렉"으로 느껴진다.

**Cobo (Mytheria 실게임 사용값)** — https://cobomakesgames.com/blog/how-to-make-combat-feel-good/ — 검증
- Hitstop: 검 4프레임(67ms), 대형무기 5프레임, 원거리 1프레임. 격투식 스펙(위 표)보다 짧다 — 장르 차이이며 어느 쪽도 정답은 아니다.
- Hit flash: 접촉 그 프레임에 시작(1프레임 늦으면 렉으로 읽힘), 일반 8프레임(133ms), 콤보 3타 11프레임.
- 넉백: 약 0.1초 슬라이드(순간이동은 글리치로 보임). 피격 기울기: 밀린 픽셀당 약 1.3° 회전, 0.2초에 걸쳐 복귀, 보스는 2–3°로 축소.
- timeScale을 건드리지 않고 해당 캐릭터의 드로잉만 정지(동기화·접근성 이유). Reduced motion 시 freeze 생략 + shake 별도 스위치.

**GameMaker 공식 튜토리얼 (간편 shake 모델)** — https://gamemaker.io/en/blog/coffee-break-tutorials-juicy-screenshake-gml — 검증
- `screenshake(steps, magnitude_px, fade)`: 대형 (30, 5px, 0.2) / 중형 (20, 3px, 0.3) / 소형 (10, 1px, 0.4). 지속 10–30프레임(약 167–500ms).

### 1.4 파티클·스쿼시 — 라이브러리 기본값 — 검증

**@debuff/juice 공식 문서** — https://debuff.jp/docs/game-feel
- Particles: 기본 **count 10**, 예시 버스트 **16개**. speed 40–120 px/s, life 0.3–0.6초(후반 페이드), size 2–4px. 풀 상한 2,000개 재사용.
- Squash & stretch: 기본 amount **0.3**, 복귀 **0.25초**. 이륙 −0.25, 착지 최대 0.35. 원점은 바닥.
- Camera shake (trauma²): 피격 trauma +0.3, 폭발 +0.6. 최대 진폭 기본 8px, 감쇠 초당 1.5 trauma.
- Hit-stop: `freeze(0.06)` 피격, `freeze(0.12)` 플레이어 사망.
- Slow motion: timeScale 0.5 예시(표준 지속시간은 없음). Reduced motion 시 shake를 1/4로 축소.

### 1.5 미검증 (참고만)

- Celeste 관용 설계(Maddy Thorson): coyote time 0.1초, jump buffer 약 0.1초 — 원글 열람 실패, 2차 요약만 존재. **미검증**.
- Kao (2020) juice 연구: juice 과다 시 역U자(중간~높음이 최적) — 스니펫만. **미검증**. 방향성 교훈으로만 사용.
- Tyler Soderwall이라는 이름의 게임 필 강연자는 확인 불가 — 인용하지 않는다.

### ✅ 우리 게임 적용값 (1. 게임 필)

- [ ] **Hitstop**: 해방 명중 80ms(약 5f) / 풀차지(과부하 90%+) 명중 120ms / 적 처치 250ms / 플레이어 피격 100ms. 정지 중에도 포즈 판정·입력 버퍼는 계속 돈다.
- [ ] **Shake**: trauma 모델 채택. 이벤트 가산 — 해방 +0.5, 적 처치 +0.7, 플레이어 피격 +0.3, 복제 성공 +0.15. `shake = trauma²`, 최대 오프셋 = 화면 높이의 1.5%, 회전 최대 1.5°, Perlin noise, 감쇠 초당 1.2. TV 모드·reduced-motion 설정 시 진폭 ×0.5 / ×0.25.
- [ ] **파티클** (풀 상한 데스크톱 2,000 / 모바일 800, 자체 결정): 복제 성공 — 손 위치 스파크 16개(0.3–0.6초, 40–120px/s). 차지 중 — 손 주변 상승 입자 초당 30개 연속 방출 + 고리 수축. 해방 폭발 — 버스트 4겹 × 16개 = 64개 + 잔불 20개(수명 0.8초, 자체 결정). 적 피격 — 방향성 스파크 10개.
- [ ] **Flash**: 적 피격 시 스프라이트 흰색 플래시 100ms(6f). 해방 순간 화면 플래시 2프레임(흰색, 알파 0.35 → 0).
- [ ] **비네트**: 과부하 게이지에 비례해 화면 가장자리 붉은 비네트(알파 0→0.45), 90% 이상에서 점멸. 차지 중 가장자리에 서리(氷) 페이드인 — 세계관 연출, 자체 결정.
- [ ] **슬로모션**: 해방 직전(스윙 하강 판정 순간) timeScale 0.5 × 120ms → 폭발과 함께 정상 복귀. 보스 처치 시 0.3 × 400ms(자체 결정).
- [ ] **적 반응**: 피격 시 넉백 슬라이드 0.1초(약 40px, 보스는 8px), 기울기 최대 3°(보스 기준), 0.2초 복귀. 처치 시 permanence — 잔해 파티클이 바닥에 3초 잔류.
- [ ] **사운드 연동**: 모든 타격음 피치 ±5% 랜덤, 콤보가 오를수록 해방음 피치 단계 상승(§2 레시피와 연동).

---

## 2. 사운드 — 무예산 설계

### 2.1 WebAudio 합성 공통 구조 — 검증

출처: MDN Web Audio API — https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API
- 구조: 소스(OscillatorNode / 노이즈 버퍼) → GainNode(엔벨로프) → [BiquadFilterNode] → destination. 브라우저 정책상 AudioContext는 사용자 제스처 안에서 `resume()` 필요.
- 엔벨로프는 선형보다 **지수 램프(exponentialRamp)** — 청각이 로그 스케일이라 자연스럽다(아래 임팩트 출처에서 강조).

### 2.2 효과음 레시피 (코드 단위) — 검증

**폭발 (노이즈 + 로우패스 스윕)** — https://www.corelumetech.in/articles/procedural-sound-generation-in-web-games.html
- 화이트노이즈 버퍼: `sampleRate × 1.2초`, `Math.random()*2-1` 채움.
- Lowpass 필터: 1000Hz → 10Hz 지수 하강(전 길이). 게인: 0.5 → 0.001 지수 하강.
- 변형(짧은 폭발): 버퍼 0.5초 — https://www.arcadehubplay.com/blog/beyond-audio-tag-retro-synthesis ("Impact/Crash: lowpass 노이즈, 300ms 지수 감쇠")
- 저음 몸통은 아래 임팩트 레시피(사인 하강)를 겹쳐 만든다 — 두 레시피의 합성이 표준 구성.

**임팩트/타격 (사인 피치 드롭)** — https://www.dianyingsir.com/posts/webaudio-api-and-psychoacoustics-of-game-audio/
- 구조: ①attack transient(2–5ms 내 광대역 버스트) ②body resonance(급격한 피치 하강) ③지수 감쇠 테일.
- 코드값: 시작 180Hz → 종료 30Hz, `duration 0.12초`, 피치 하강은 전체의 40% 지점(0.048초)까지. 게인: 0.001 → 1.0 (4ms 어택) → 0.001 (전 길이 지수 감쇠).

**상승 스윕 (점프/차지 공용 패턴)** — https://arcadehubplay.com/blog/web-audio-api-retro-synthesis
- 삼각파 150Hz → 600Hz 지수 상승, 0.25초. 게인 0.2 → 0.01.
- 변형: 삼각파 100→600Hz, 100ms (같은 출판사 Beyond 글). 긴 차지는 같은 램프의 duration만 늘려 적용(적용은 자체 판단).

**성공 차임** — https://shineyrock.com/blog/read/the_web_audio_api_adding_sound_to_your_web_app/
- 원리: 끝음이 올라가는 모티프가 밝게 들린다. 음마다 **디튠한 삼각파 2개(freq+1, freq-2)** 로 코러스감, 게인 0.1, 끝 0.05초 페이드.
- 성공 모티프 실측값: **B4 493.883Hz × 0.116초 → E5 659.255Hz × 0.232초** (앞 음이 끝나는 순간 다음 음 시작).
- 코인형 변형: 사각파 950Hz×80ms → 1300Hz×150ms (ArcadeHub Beyond).

**경고 알람** — https://www.hackerscreen.live/learn/web-audio-api-sound-effects.html / ArcadeHub Beyond
- 클랙슨: 톱니파, 440Hz → (0.12초 후) 880Hz 이산 점프, 게인 0.06 → 0.001 (0.25초/버스트), 반복 호출로 지속.
- 워블 사이렌: 메인 오실레이터 + LFO(15Hz)를 게인 50(±50Hz)으로 frequency에 연결.
- 음색 가이드: 톱니파 = 거칠고 날카로움(알람·레이저), 사각파 = 밝고 속 빈(펀치·점프), 삼각파 = 어둡고 부드러움(둔한 임팩트), 사인 = 순수( UI).

**jsfxr (프로토타이핑 도구)** — https://sfxr.me / https://github.com/chr15m/jsfxr/
- 프리셋: `sfxr.generate("explosion" | "powerUp" | "hitHurt" | "pickupCoin" | "laserShoot" | ...)` 후 `sfxr.play()`. 파라미터 객체로 엔벨로프·주파수·LPF/HPF를 코드에서 직접 지정 가능, WAV 내보내기 지원.

### 2.3 무료 사운드/음악 — 라이선스 원문 확인 — 검증

**Kenney.nl — CC0** — https://kenney.nl/support (공식 지원 페이지 원문)
> "Yes, all game assets on the asset pages are public domain licensed (CC0). You're free to use them, even in commercial projects."
> "Attribution is not required."
- 오디오 팩, UI 사운드, 음악 징글 등 다수. **1순위 소스.**

**Freesound.org — 에셋별 상이** — https://freesound.org/help/faq/ (원문)
> 업로더가 CC0 / CC-BY / CC-BY-NC 중 선택. "for the 'zero' license you can do pretty much what you want with the sound. You could even sell the sound... but you can't claim you are the author!" / CC-BY는 출처 표기 필수 / CC-BY-NC는 "you can't earn any money with the piece of work you create"
- **CC0 필터로만 사용**. 레거시 Sampling+ 라이선스도 존재 — 회피.

**OpenGameArt.org — 에셋별 상이** — https://opengameart.org/content/faq (원문)
> "Yes, you can use any of the art submitted to this site. Even in commercial projects. Just be sure to adhere to the license terms."
> CC0 = 표기 없이 상업 사용 가능 / CC-BY = 표기 필수, DRM 배포망 제한 주의 / CC-BY-SA = 동일 라이선스 전파 / GPL 에셋도 섞여 있어 비GPL 프로젝트는 주의(FAQ가 직접 경고)
- **CC0와 CC-BY만 사용, GPL·CC-BY-SA 회피.**

**jsfxr 라이선스** — https://github.com/chr15m/jsfxr/ (원문: "License: The Unlicense"), https://sfxr.me 비교표에 Free/Pro 모두 "Unrestricted commercial use" 체크.
- Bfxr의 권리 문구("You have full rights to all sounds made with bfxr...")는 검색 스니펫만으로 확인 — **미검증**(페이지 직접 열람 전).

### ✅ 우리 게임 적용값 (2. 사운드)

- [ ] **해방 폭발**: 노이즈 0.7초(1.2초 레시피를 게임 템포에 맞춰 단축, 자체 결정) + 로우패스 1000→10Hz + 사인 180→30Hz(0.3초) 몸통 레이어. 풀차지 시 노이즈 길이 1.0초 + 게인 상향.
- [ ] **차지 라이저**: 차지 게이지에 실시간 연동 — 사인+톱니파(게인 0.05) 200Hz → 1200Hz를 게이지 0→100 구간에 매핑(상승 스윕 패턴 확장), 80%부터 LFO 15Hz ±30Hz 워블 추가(과부하 임박 신호).
- [ ] **복제 성공 차임**: B4(493.88Hz, 0.116초) → E5(659.26Hz, 0.232초), 디튠 삼각파 쌍, 게인 0.1. 포즈별 음정 변형은 자체 결정(감마/델타는 5도 아래 모티프).
- [ ] **과부하 경고**: 85%부터 클랙슨 버스트(톱니파 440/880Hz, 0.25초)를 0.8초 간격 반복, 게인 0.06으로 작게 — 짜증 방지.
- [ ] **적 피격**: 임팩트 레시피(180→30Hz, 0.12초) + 노이즈 크래시 300ms 레이어, 피치 ±5% 랜덤(§1 연동).
- [ ] **프로토타입 순서**: 블록 3(핵심 루프)에서는 jsfxr 프리셋(explosion/powerUp/hitHurt)으로 즉시 붙이고, 블록 6에서 위 WebAudio 레시피로 교체·튜닝한다.
- [ ] **에셋 정책**: 외부 파일은 Kenney(CC0) + Freesound(CC0 필터) + OpenGameArt(CC0/CC-BY)만. 사용 목록과 출처를 `assets/CREDITS.md`에 전수 기록(CC0도 기록은 남긴다). CC-BY-NC·GPL·Sampling+ 사용 금지.
- [ ] **BGM**: Kenney 음악 팩(CC0) 루프 + 차지 중에는 베이스 레이어만 페이드인하는 2레이어 구성(자체 결정).

---

## 3. 모션/포즈 게임 UX

### 3.1 다음 동작 예고 (텔레그래핑) — 검증

**Dance Central 포스트모템 (Harmonix)** — https://www.gamedeveloper.com/production/postmortem-harmonix-s-dance-central-2010-
- 프로토타입에서 **포즈 매칭과 젬 히팅 방식을 버렸다** — 동작('Lean n' Rock' 등)을 전달하지 못했기 때문. 수개월 반복 끝에 정착한 것은 **동작 이름 + 플래시카드(픽토그램 카드)**. 팀 시간 대부분을 "플래시카드와 스포트라이트 HUD가 적절한 정보를 적절한 타이밍에 전달하는가"에 썼다.
- GDC 보고: Rock Band식 우→좌 스크롤 아이콘, 3D 에어 트레일(실시간으로 읽기 힘들어 폐기), 아바타 주변 젬(복잡한 동작을 버려야 해서 폐기). 살아남은 것: 동작 고유 이름, 비트 단위 시각 피드백, **한 음절 동사 바크("cross", "back", "hit")** — https://www.gamespot.com/articles/dance-central-could-have-had-dedicated-hardware-designer/1100-6328965/

**Just Dance — Gold Move** — https://dlassets-ssl.xboxlive.com/public/content/f0423eee-f580-4106-bac7-9f747bda2773/GameManual/cd3b3184-a80e-4857-9638-779a9bfecb5e/en-GB/index.html (공식 매뉴얼, 검증)
- 특별 동작은 **금색 픽토그램 + 코치 주변 특수효과**의 이중 신호로 예고한다. 아이콘 단독에 의존하지 않는다.
- 픽토그램이 하단을 스크롤하며 미리 보여주는 방식 자체는 리뷰 다수에서 확인되나, **예고 리드타임(초/비트)을 명시한 1차 출처는 없음 — 미검증**. 픽토그램은 속도와 반복 횟수를 인코딩하지 못한다는 리뷰 지적도 있다.

**연습 모드 "Break It Down"** — 위 포스트모템/GDC, 검증
- 실제 댄스 강사 방식 차용: 복습, **플레이어가 선택하는 슬로다운**, 동사 바크. 전체 플레이의 20%가 이 모드에서 소비됐다 — 튜토리얼/연습은 본편만큼 중요하다.

### 3.2 판정 관용도와 근접 피드백 — 검증

**Just Dance 평가 등급** (공식 매뉴얼, 검증)
- 등급마다 교정 지시를 붙인다: FAIL "뭔가 놓쳤다" / **OK "나쁘지 않다. 댄서와 동기화를 더 맞춰보라"(타이밍 문제로 프레이밍)** / **GOOD "좋다. 에너지를 더 높이고 리듬을 유지하라"(에너지 문제로 프레이밍)** / PERFECT. 별은 곡 종료 후가 아니라 **플레이 중에 표시**.
- 종료 후 "Style" 코멘트도 진단형: "Great Finisher", **"Exhausted: 후반이 전반보다 에너지가 떨어졌다"**.
- **판정 허용 수치(ms·각도·% 일치)는 어떤 1차 출처에도 공개되어 있지 않다** — 검증된 부재(不在).

**Dance Central 검출 튜닝 교훈** (포스트모템, 검증)
- 검출 품질이 경험을 좌우한다: **노이즈 많은 스켈레톤 데이터와 스켈레톤 "뭉개짐"을 우아하게 처리**하는 것, 플레이어가 센서 화각을 벗어나는 경우의 처리가 핵심 투자였다.
- 검출은 곡(콘텐츠)마다 저작·튜닝·검증이 필요했고, 검증된 방식을 나머지 31곡에 적용하는 데만 3주 "검출 크런치"가 걸렸다.
- 난이도 설정 실패담: 쉬운 동작을 디자이너 감각으로 정하면 틀린다. **춤 못 춘다고 자인하는 직원에게 직접 가르쳐보며 빨리 익히는 동작을 골라** 첫 티어를 만들었다 — 초보 실측 기반 캘리브레이션이 정답.

### 3.3 피로 관리 — 검증 + 미검증 혼재

- Dance Central QA는 전문가 안무를 수주간 반복하다 신체·정신적으로 소진됐다 — "신체 요구량을 과소평가하기 쉽다"가 포스트모템의 명시적 교훈. (검증)
- Just Dance "Just Sweat" 플레이리스트: **10분/20분/40분 세션**을 계획하게 한다 — 세션 길이를 모드 설계에 내장. (검증, 공식 매뉴얼)
- Kinect for Windows HIG v1.8의 피로 항목: **손을 머리 위로 오래 들고 있게 하지 말 것**, 한 손/양손 제스처를 번갈아, "피로가 늘면 동작이 지저분해지고 성능과 만족이 떨어진다" — 문서는 열었으나 해당 섹션 도달 전 열람 제한으로 **미검증**(재열람 필요). 원문 위치: https://www.slideshare.net/slideshow/human-interface-guidelinesv180/26435606
- Xbox 접근성 가이드라인 107: **2–3초 이상의 홀드**를 피로 기준으로 지목, 중요 입력에는 대체 입력 제공, 민감도 ±50% 조정 — 검색 스니펫만 확인, **미검증**. https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/107
- Ring Fit Adventure의 Assist Mode(특정 부위를 쓰는 동작을 버튼으로 대체)·Silent Mode는 닌텐도 공식 페이지 스니펫으로만 확인 — **미검증**. 홀드 시간(초) 수치는 어떤 출처에서도 얻지 못했다.

### ✅ 우리 게임 적용값 (3. 모션 UX)

- [ ] **텔레그래핑 3중 신호**: ① 적의 텔레그래프 포즈(스프라이트가 포즈를 취함) ② 화면 우하단 픽토그램 카드(다음 포즈, 금색 테두리 = 해방 가능 구간) ③ 포즈 이름 텍스트 + 짧은 동사 바크("교차!" "펼쳐!"). 아이콘 단독 금지(Dance Central 교훈).
- [ ] **예고 리드타임** (자체 결정 — 1차 출처에 수치 없음): 적이 포즈를 취하기 **1.2초 전**부터 픽토그램 카드가 슬라이드인하고, 판정 윈도 시작 시 카드가 중앙으로 확대. 현재 홀드 중에도 다음 포즈를 작게 미리 표시한다.
- [ ] **연속 유사도 피드백**: 판정은 이진이 아니라 유사도 %(관절 각도 차이 기반)를 게이지로 실시간 표시 — "거의 맞음"이 눈에 보여야 답답하지 않다. 등급 3단계: 미스 / 근접(유사도 70–89%, 교정 힌트 표시: 예 "왼팔을 더 올려") / 성공(90%+, 자체 결정 — 출처에 공개 수치 없음).
- [ ] **교정 힌트**: 가장 각도 오차가 큰 관절 하나만 골라 방향 힌트 1개를 표시한다(Just Dance의 등급별 교정 문구 방식). 힌트는 한 번에 하나.
- [ ] **노이즈 관용**: 검출이 뭉개지는 프레임은 판정에서 제외하고 직전 유효 포즈를 0.35초까지 유지한다(§5의 드롭아웃 그레이스와 연동). 플레이어가 화각을 벗어나면 "프레임 안으로" 안내를 즉시 표시.
- [ ] **피로 설계**: 머리 위로 올리는 동작은 해방 스윙(1초 미만)뿐, 홀드 포즈는 전부 어깨 높이 이하. 복제 홀드 판정 0.3초, 차지 최대 약 3초(과부하 강제 해방 구조라 장시간 홀드 불가). 감마는 좌/우 변형을 번갈아 출제. 라운드 사이 스토리 카드가 곧 휴식 구간. 세션 권장 10분 표기(Just Sweat 방식).
- [ ] **노페일**: 라운드 도중 실패로 종료하지 않는다 — 미스하면 콤보만 리셋(자체 결정. Just Dance의 관용 구조와 같은 방향이나 해당 주장은 미검증 출처 기반임을 명시).
- [ ] **연습 모드**: 블록 6 이후 "포즈 연습" 화면 — 판정 없이 유사도만 표시하고 천천히 익히는 모드(Break It Down 교훈: 전체 이용의 20%가 연습이었다).
- [ ] **캘리브레이션**: 첫 실행 시 포즈 4종을 한 번씩 따라 하게 해 개인 허용 오차를 측정, 기본 허용 ±18°에서 개인값으로 조정(초보 실측 기반 — Dance Central 난이도 교훈).

---

## 4. HUD/UI — TV 2–4m 가독성

### 4.1 최소 글자 크기 — 검증

**Xbox 접근성 가이드라인 XAG 101** — https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/101
- 최소 기본 본문(body height 기준): **콘솔 26px @1080p** (4K는 52px), PC 18px @1080p. 아이콘 안 글자도 동일 기준, 글자 스케일링은 최소값의 200%까지.
- 플랫폼 화면 확대는 작은 글자의 대안이 되지 않는다고 명시.

**Microsoft "Designing for Xbox and TV"** — https://learn.microsoft.com/en-us/previous-versions/windows/uwp/xbox-apps/designing-for-tv
- 10-foot = 약 10피트(약 3m) 거리 전제. 정보량은 "데스크톱이 아니라 모바일 수준"으로.
- 본문 최소 15 epx(960×540 설계 단위) = 200% 스케일 환산 **30px @1080p**, 보조 정보 12 epx = 24px. 인터랙티브 요소 최소 높이 32 epx(=64px @1080p).

**보조 확인** (2차 정리 페이지, 검증): Android TV 최소 본문 24sp·제목 48sp 이상(Google 권장), TV 본문 최소 28px @1080p 규칙 — https://uiuxatlas.com/lessons/responsive/tv-and-10-foot-ui-design/ , https://www.purrweb.com/blog/how-to-design-an-app-for-smart-tvs/

### 4.2 대비 — 검증

**XAG 102** — https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/102
- 큰 요소(콘솔 기준 52px @1080p 이상): **≥3:1**. 중요 정보를 주는 표준 크기 텍스트/요소: **≥4.5:1**. 비활성 요소 텍스트: ≥3:1.

**WCAG 2.2 (1.4.3)** — https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- 텍스트 ≥4.5:1, 큰 텍스트(18pt 또는 14pt bold 이상) ≥3:1. 4.499:1은 4.5:1을 충족하지 않는다(반올림 금지).

### 4.3 세이프 에어리어 / 오버스캔 — 검증

- **Android TV 레이아웃 가이드**: 오버스캔 대응 **5% 마진 — 좌우 48dp, 상하 27dp** (960×540 기준). 배경은 이 영역에 가두지 말 것. — https://developer.android.com/design/ui/tv/guides/styles/layouts (페이지 안에 58dp/28dp라는 두 번째 수치도 함께 있어 내부 불일치 — 보수적으로 큰 값 채택이 안전)
- **Microsoft TV**: 필수 UI는 가장자리 5% 안에 두지 말 것. 상하 27epx, 좌우 48epx 회피. (위 4.1 출처)
- **EBU R 095** (방송 규격): 액션 세이프 3.5%, **그래픽 세이프 5%** (상하좌우). — http://tech.ebu.ch/publications/r095
- BBC GEL IPTV의 "최소 24px, 세이프 화이트 #EBEBEB / 세이프 블랙 #101010"은 미러 문서 스니펫만으로 확인 — **미검증**.

### 4.4 동시 HUD 요소 수 — 검증된 부재

열람한 어떤 가이드라인(MS UWP/XAG, Android TV, Samsung Tizen, EBU, WCAG)도 **HUD 요소 최대 개수를 숫자로 정하지 않는다**. 가장 가까운 검증 문구는 Microsoft의 "TV의 정보량은 모바일 수준" + Android TV의 "필수 정보만, 패널을 늘리지 말 것"뿐이다. 개수는 우리가 정해야 한다.

### ✅ 우리 게임 적용값 (4. HUD)

- [ ] **세이프 마진**: 모든 HUD를 화면 가장자리 **5% 안쪽**(1080p 환산 좌우 96px·상하 54px)에 배치. 스토리 카드 등 읽어야 하는 텍스트는 10% 안쪽(타이틀 세이프).
- [ ] **글자 크기** (1080p 캔버스 기준, 캔버스 해상도에 비례 스케일): 본문 최소 **28px**, HUD 핵심 수치(게이지 %·콤보) **40px**, 경고·포즈 이름 **56px**. 얇은 웨이트(300 이하) 금지, 최소 500 이상.
- [ ] **대비**: 중요 텍스트·게이지 ≥4.5:1, 큰 장식 요소 ≥3:1. 카메라 영상 위에서는 배경 밝기가 계속 변하므로 **모든 HUD 뒤에 반투명 다크 칩(알파 0.55 이상)** 을 깔아 대비를 보장한다.
- [ ] **동시 표시 상한 5개** (자체 결정 — 가이드라인에 수치 없음): 적 체력바 / 과부하 바 / 공명 게이지 / 콤보 / 다음 포즈 픽토그램. 나머지는 전부 일시 표시(피격 플래시, 데미지 숫자, 힌트)이며 1초 내 소멸.
- [ ] **색각 배려**: 성공/실패를 색만으로 구분하지 않는다 — 성공은 게이지 충전 + 체크 아이콘 + 상승 차임, 실패는 X 아이콘 + 하강음으로 이중 인코딩(§2·§3과 연동).
- [ ] **TV 모드 판별**: 미러링 자체는 웹에서 검출 불가 — 설정에서 "TV 모드" 토글(폰트 ×1.3, 진폭 감쇠, 안전 마진 7%로 확대 — 자체 결정)을 제공한다.

---

## 5. MediaPipe Pose — 브라우저 구현

### 5.1 공식 문서 (PoseLandmarker Web) — 검증

출처: https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js (2026-11-11 갱신본 열람)

- 패키지 `@mediapipe/tasks-vision`, 생성 패턴:
```js
const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm");
const poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
  baseOptions: { modelAssetPath: "pose_landmarker_lite.task", delegate: "GPU" },
  runningMode: "VIDEO", numPoses: 1 });
```
- 모델 3종(lite/full/heavy) 모두 landmarker 입력은 **256×256×3 고정** — 카메라 해상도를 올려도 모델 입력은 같으니, 해상도는 랜드마크 안정성과 CPU 비용의 트레이드오프일 뿐이다. 공식 페이지에 카메라 해상도 권장값·모델별 FPS·용량 표는 **없다**(검증된 부재).
- 옵션 기본값: `minPoseDetectionConfidence 0.5`, `minPosePresenceConfidence 0.5`, `minTrackingConfidence 0.5`, `numPoses 1`, `outputSegmentationMasks false`. Web에는 LIVE_STREAM 모드가 없다 — 실시간은 **VIDEO 모드 + requestAnimationFrame**.
- 출력: landmarks(정규화 좌표, `visibility`/`presence` 각 0–1), worldLandmarks(미터 단위, 원점 = 양쪽 엉덩이 중간). 33개 랜드마크 중 우리 게임 핵심: 어깨 11/12, 팔꿈치 13/14, 손목 15/16, 엉덩이 23/24.
- 공식 베스트 프랙티스: `video.currentTime`이 이전과 같으면 detectForVideo를 건너뛴다(중복 프레임 방지 가드). 타임스탬프는 단조 증가 필수.

### 5.2 모델별 실측 레이턴시 (실물 프로젝트) — 검증

**Bouncy Feet (댄스 게임, 오픈소스)** — https://deepwiki.com/jakmeier/bouncy-feet/2.4-mediapipe-integration (소스 요약 열람)

| 모델 | 데스크톱 | 모바일 | 비고 |
|---|---|---|---|
| lite | ~20ms | ~70ms | 기본 채택 |
| full | ~30ms | ~100ms | 옵션 |
| heavy | ~100ms | 사용 불가 | 실시간 부적합 |

- 실효 FPS는 캡처 제한으로 데스크톱 ~30, 모바일 15–30이 일반적이라고 명시.
- 신뢰도 임계는 기본 0.5 대신 **0.4** 로 낮춰 운용. `fullyVisible` 판정에 visibility를 신뢰하지 않고(옆모습에서 낮게 나옴) 랜드마크 좌표 범위([-1,1])로 검사.

**RepsForReels** — https://repsforreels.app/blog/how-ai-pose-detection-counts-your-reps — 검증
- 스마트폰 CPU에서 full ~30ms/프레임(30+FPS), heavy ~80ms/프레임.

**LiteRT.js Mocap (실물 앱)** — WebGPU 추론 ~7ms vs CPU ~25ms (Apple Silicon 실측, 저장소 소개 페이지 열람). GPU delegate가 사실상 필수라는 방증.

### 5.3 스무딩 — One Euro 필터 실측 튜닝값 — 검증

**원논문 페이지 (Casiez et al., CHI 2012)** — https://cristal.univ-lille.fr/~casiez/1euro/
- 만능 프리셋은 없다 — 절차만 제시: beta=0으로 두고 **fcmin(minCutoff)을 1Hz 근처**에서 시작해 정지 시 지터가 사라질 때까지 내리고, 그다음 빠른 동작에서 **beta를 0.001/0.0001 단위(10배씩)** 조정해 랙을 줄인다. 원리: `cutoff = minCutoff + beta × |속도|`.

**실물 적용값들** (전부 열람 검증):
- RepsForReels(포즈 랜드마크): **minCutoff 0.8, beta 0.01** 을 기본값으로 사용. 핵심 기법 — **스무딩은 시각 오버레이에만 쓰고, 판정(렙 카운트)은 원본 각도로 한다.**
- Neural Canvas 기술보고서: `OneEuro(0.9, 0.04, dCut 1.0)`, 실측 후 1.3/0.05 → **0.9/0.04** 로 재튜닝. **dt를 performance.now()로 실측**해 프레임 드롭 시에도 필터가 어긋나지 않게 한다. Pose 모드에서 **visibility < 0.35 랜드마크는 버리고**, 5프레임 연속 누락까지는 유지.
- Egg Catcher(포즈 게임): 속도 적응형 지수 스무딩(One-Euro식, cutoff 8–30Hz 범위) + **한쪽 손목이 사라지면 0.35초 유예** 후 추정 유지. 머리 랜드마크는 visibility 임계 0.3으로 낮춤.

### 5.4 포즈 분류 — 각도 FSM이 표준 — 검증 (GitHub 실물)

- **BeetFit** — https://github.com/Rork96/BeetFit — lite 모델 + GPU. 관절각 상태머신 실측 임계: 스쿼트 hip-knee-ankle **<100° → >160°**, 컬 shoulder-elbow-wrist **<60° → >150°**, 프레스 **100°/160°**.
- **ai-gym-bro-web** — https://github.com/umersmx/ai-gym-bro-web (해설: https://dev.to/umersmx/how-i-built-an-in-browser-ai-workout-tracker-using-react-and-mediapipe-573b) — 각도 계산은 세 점의 atan2 차이. **히스테리시스 FSM**: 컬 기준 팔꿈치 **<35°에서 UP 전이, >160°에서 DOWN 전이** — 진입/이탈 임계를 벌려 떨림을 죽인다. 성능 기법: 좌표는 ref에, 그리기는 Canvas 직접, React state는 카운트·경고가 바뀔 때만.
- **Spotter** — https://github.com/naichuanzhang/spotter/blob/HEAD/CLAUDE.md — full 모델, 30fps. 푸시업 **100°(down) / 115°(up)** 히스테리시스. 관절이 화각 밖이면 각도를 null로 버린다(낡은 값 재사용 금지).
- **gym-form-corrector** — https://github.com/rohaanahmadtech/gym-form-corrector/blob/HEAD/README.md — ML 분류(GRU, 30프레임×210특징, 영상 단위 95%)와 규칙 기반 폼 판정을 **분리** 운용. 무거운 ML은 "무슨 동작인가"까지만, 판정은 해석 가능한 규칙으로.
- 커뮤니티 실무 문서 — https://github.com/liuchiawei/agent-skills/blob/HEAD/skills/3d/mediapipe-usage/SKILL.md — detectForVideo를 **33ms 간격(약 30Hz)으로 스로틀**, **연속 N프레임 유지돼야 토글/제스처 발동**, 파생값에 스무딩 0.3 + 데드존.

### 5.5 미검증

- Medium 실전 가이드(카메라 ideal 1280×720·30fps, CPU 10–15FPS vs GPU 60+FPS, minTrackingConfidence 0.6–0.7) — 열람이 429로 실패, 스니펫만. **미검증**. https://medium.com/@creativeaininja/real-time-body-tracking-in-your-browser-what-mediapipe-actually-does-and-how-to-use-it-b31aa96a5071

### ✅ 우리 게임 적용값 (5. MediaPipe)

- [ ] **모델/모드**: PoseLandmarker **lite + GPU delegate, VIDEO 모드**, numPoses 1, 신뢰도 3종 기본 0.5로 시작(추적 끊김이 잦으면 0.4로 하향 — Bouncy Feet 운용값). heavy는 쓰지 않는다.
- [ ] **입력 해상도**: 기본 **640×480** (모델 입력 256×256이라 판정 품질 손실이 적고 모바일 레이턴시 예산 ~70ms 안에 든다). 데스크톱에서만 옵션으로 1280×720 허용.
- [ ] **프레임 처리**: rAF 루프 + currentTime 중복 가드. 추론이 33ms를 넘으면 검출을 ~30Hz로 스로틀하고 렌더링(60fps)과 분리한다. 좌표는 배열 ref에 보관, DOM/React state는 게임 상태가 바뀔 때만 갱신.
- [ ] **스무딩 분리**: 판정은 **원본 랜드마크 각도**로, 손 이펙트 위치·고스트 가이드 등 시각 요소만 One Euro(minCutoff **1.0**, beta **0.03** 시작값 — 검증된 실측 범위 0.8–1.3 / 0.01–0.05의 중간) + dt 실측.
- [ ] **가시성 게이트**: 판정에 쓰는 랜드마크는 **visibility ≥ 0.5** 요구. 하나라도 미달이면 그 프레임은 판정 제외. 손목 1개 소실 시 **0.35초 유예**(직전 오프셋으로 추정), 초과 시 포즈 무효 + "프레임 안으로" 안내(§3 연동).
- [ ] **분류 방식**: ML 분류기 없이 **관절각 + 상대 위치 규칙 FSM**. 포즈별 진입/이탈 임계에 **히스테리시스 10°** 적용. 발동 조건: 최근 10프레임 중 다수 일치 + **0.3초 지속**(스펙 확정값 유지 — 연속 프레임 카운터 방식과 동등).
- [ ] **좌표계**: 미러 표시 기준 `x' = 1 − x` 로 먼저 변환한 뒤, 어깨너비 정규화 좌표로 판정(기기·해상도 독립 — 스펙 확정 사항과 일치).
- [ ] **포즈 정의 (각도 기준, 자체 결정 — BeetFit류 임계 운용 방식을 우리 포즈에 적용한 것)**: 알파 = 양 손목이 몸 중심선을 반대편으로 교차 + 팔꿈치각 40–110°. 베타 = 양 팔꿈치각 ≥160° + 손목 높이와 어깨 높이 차 ≤ 어깨너비 0.35. 감마 = 한쪽 팔꿈치각 ≥150°·손목이 머리 위, 반대쪽 손목이 엉덩이 아래. 델타 = 양 손목 간 거리 ≤ 어깨너비 0.3 + 손목 중심이 명치 높이 ±0.3(어깨너비 단위).
- [ ] **해방 스윙 판정**: CHARGED 상태에서만 활성. 양 손목이 머리(코 랜드마크) 위 → 0.6초 내 가슴 아래로 하강 + 하강 속도 임계(자체 결정: 어깨너비/초 × 2.5). 판정도 원본 좌표 사용.
- [ ] **폴백**: GPU delegate 초기화 실패 시 CPU로 자동 폴백 + 성능 모드(해상도 480×360, 파티클 상한 축소) 전환을 사용자에게 표시한다.

---

## 부록. 출처 검증 상태 요약

**검증 (원문 열람)**
- 게임 필: Eiserloh GDC 2016 슬라이드 전문 / GameDesignerX 피드백 스펙 / Cobo Mytheria 실사용값 / GameMaker 공식 튜토리얼 / @debuff/juice 문서 / GMTK 자막 / Nijman·Jonasson 강연 전사·요약
- 사운드: MDN Web Audio / Corelume 폭발 레시피 / ArcadeHub 합성 2편 / dianyingsir 임팩트 레시피 / shineyrock 차임 / hackerscreen 알람 / jsfxr GitHub·sfxr.me / Kenney 지원 페이지 / Freesound FAQ / OpenGameArt FAQ
- 모션 UX: Dance Central 포스트모템(Game Developer) / Dance Central GDC 보도(GameSpot) / Just Dance 2014 공식 매뉴얼(Xbox)
- TV UI: XAG 101·102 / MS Designing for Xbox and TV / Android TV 레이아웃 가이드 / EBU R 095 / WCAG 2.2 대비 이해 문서
- MediaPipe: PoseLandmarker 공식 Web 문서 / One Euro 원논문 페이지 / RepsForReels / Neural Canvas 보고서 / BeetFit / ai-gym-bro-web / Spotter / gym-form-corrector / Egg Catcher / Bouncy Feet(DeepWiki 소스 요약) / 커뮤니티 mediapipe-usage 스킬 문서

**미검증 (스니펫만 — 인용 시 재열람 필요)**
- "Nijman sleep 20ms"류 수치 (전사에 없음 — 사용 금지)
- Celeste coyote time 0.1초 / jump buffer 수치
- Kao (2020) juice 역U자 연구
- Kinect HIG v1.8 피로 섹션 원문 / Xbox 접근성 107 (홀드 2–3초, 민감도 ±50%)
- Ring Fit Assist/Silent Mode 공식 설명
- Just Dance 픽토그램 리드타임, 노페일 구조
- BBC GEL IPTV 최소 24px·세이프 컬러
- Bfxr 권리 문구 / Medium MediaPipe 실전 가이드 수치

**검증된 부재 (없다는 것 자체를 확인)**
- 고전 주스 강연 3종에는 hitstop·파티클 개수의 구체 수치가 없다 (수치는 현업 스펙표와 라이브러리 문서에서 가져옴)
- Just Dance/Dance Central의 판정 허용 수치(ms·각도)는 공개되어 있지 않다
- TV 가이드라인 어디에도 동시 HUD 요소 수의 숫자 상한은 없다
- MediaPipe 공식 페이지에는 카메라 해상도 권장값과 모델별 FPS/용량 표가 없다
