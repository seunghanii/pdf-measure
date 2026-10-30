// 키보드 단축키가 글자 입력을 가로채지 않도록: 입력 칸에 쓰는 중인지
export const isTypingTarget = (el) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(el?.tagName) || !!el?.isContentEditable
