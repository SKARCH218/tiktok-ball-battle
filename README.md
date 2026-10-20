# TikTok Ball Battle

TikTok LIVE 시청자가 채팅으로 팀(기본 A/B)에 참가해 서로 스킬을 쏘며 싸우는 게임입니다.
Electron 앱이며, 후원·좋아요·팔로우 이벤트는 [tiktok-live-connector](https://www.npmjs.com/package/tiktok-live-connector)로 받습니다.

## 실행 (개발)

```bash
cd app
npm install
npm start
```

설정창에서 TikTok 아이디를 넣고 "시작하기"를 누르세요. 아이디 없이 "데모 모드"로 미리 볼 수도 있습니다. 게임 중 `Esc`로 설정창에 돌아옵니다.

## Windows exe 만들기

```bash
cd app
npm install
npm run dist     # app/dist/BallBattle.exe (설치 없이 실행되는 단일 파일)
```

## 규칙

- 채팅에 팀 키(A/B)를 치면 참가. 탈락하면 부활하지 않고 승패 없이 계속 진행됩니다.
- 후원 1건 = 3턴 동안 해당 후원의 스킬로 공격 (최대 15턴). 좋아요/팔로우는 장미 효과 5초(1인 1회).
- 스킬 목록은 화면 오른쪽 아래, 데모 모드에서는 ▶ 버튼으로 바로 시험할 수 있습니다.

## 참고

- TikTok 비공식 라이브러리를 쓰므로 TikTok 쪽 변경으로 연결이 끊길 수 있습니다.
- `app/renderer/gifts/`의 아이콘은 TikTok 후원 이미지입니다. 저장소를 공개할 때는 사용 가능 여부를 확인하세요.
