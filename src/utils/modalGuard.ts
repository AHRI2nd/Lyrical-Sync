// 전체화면 백드롭 모달이 하나라도 열려 있으면 true.
// 드래그 오버레이(pointer-events-none)는 모달이 아니므로 제외.
// 전역 편집 단축키(Space 스탬프, Backspace, 글자 모드 키)가 모달 뒤에서
// 의도치 않게 동작하는 것을 막기 위해 사용한다.
export function anyModalOpen(): boolean {
  return document.querySelector(".fixed.inset-0:not(.pointer-events-none)") !== null;
}
