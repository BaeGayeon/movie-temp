// 글꼴 이름만 저장한다(CSS 를 깨뜨릴 수 있는 글자는 뺀다). popup, 글꼴 불러오기 화면에서 같이 쓴다.
export const cleanFont = (v) => String(v ?? '').replace(/["'\;{}<>()]|[\u0000-\u001f]/g, '').trim().slice(0, 80);
