// 박스 종류(메모·링크·Equipment)별 아이콘. 툴바 단추와 도면 위 박스 오른쪽 위 표시가 같은 모양을 씀 (24×24, 선 2)
export const MEMO_ICON = 'M5 4h10l4 4v12H5zM15 4v4h4M8 12h8M8 16h5'
export const LINK_ICON = 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1'
export const EQUIP_ICON = 'M5 10a7 7 0 1014 0 7 7 0 10-14 0zM12 10l3.5-3M12 17v4M9 21h6'

// 툴바의 박스 종류 단추. 도구는 모두 'memo', markupStyle.memoKind 로 구분
export const BOX_TOOLS = [
  { id: 'memo', kind: 'note', label: '메모 박스', key: 'N', icon: MEMO_ICON },
  { id: 'link', kind: 'link', label: '링크 박스', key: 'K', icon: LINK_ICON },
  { id: 'equip', kind: 'inst', label: 'Equipment', key: 'E', icon: EQUIP_ICON },
]
