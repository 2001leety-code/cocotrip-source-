# TikTok 사진 주소 소유 확인

- 사진의 공개 접근(HTTP 200)과 TikTok 앱의 주소 소유 확인은 별개다.
- 공식 `business/property/list` 조회에서 등록된 주소가 없음을 확인했다.
- `business/property/add`가 발급한 정확한 파일명·서명을 `public/social-media/`에 보관한다. 이 파일은 공개 소유 확인용이며 앱 비밀키나 OAuth 토큰이 아니다.
- `/social-media/` URL 접두사만 확인한다. 사진 업로드의 형식·권리 검사나 계정 권한을 변경하지 않는다.
- 배포 후 파일의 HTTP 200, 리디렉션 없음, 본문 일치 및 `business/property/verify`의 `property_status=1`을 각각 확인한다.
- 소유 확인 통과만으로 게시 성공이라고 하지 않는다. 별도 게시 접수 ID·게시 상태·공개 게시물을 확인해야 한다.

오답: JPG가 정상 공개됐다는 이유로 소유 확인도 끝났다고 가정하지 않는다. 외부 게시 응답이 불명확하면 기존 게시물 목록을 확인한 뒤 통제된 재승인 절차를 사용한다.
