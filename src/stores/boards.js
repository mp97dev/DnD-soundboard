import { defineStore } from 'pinia'
import { useLibraryStore } from './library'

let uid = () => Math.random().toString(36).slice(2, 10)

export const useBoardsStore = defineStore('boards', {
  state: () => ({
    boards: [],
    currentBoardId: null,
    selectedButtonId: null,
    mode: 'play' // 'play' | 'edit'
  }),
  getters: {
    current: (s) => s.boards.find((b) => b.id === s.currentBoardId) ?? null,
    selectedButton() {
      return this.current?.buttons.find((b) => b.id === this.selectedButtonId) ?? null
    }
  },
  actions: {
    async load() {
      this.boards = await window.api.boards.list()
      if (!this.currentBoardId && this.boards.length) {
        this.currentBoardId = this.boards[0].id
      }
    },
    async openBoard(id) {
      this.currentBoardId = id
      this.selectedButtonId = null
      // Ri-scarica in background i file mancanti usati dalla board,
      // senza bloccare il cambio di board
      const library = useLibraryStore()
      const trackIds =
        this.current?.buttons.flatMap((b) => [b.trackId, b.visualId]).filter(Boolean) ?? []
      library.redownloadMissing(trackIds)
    },
    async createBoard(name) {
      const board = {
        version: 1,
        id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + uid(),
        name,
        rows: 8,
        cols: 12,
        buttons: []
      }
      this.boards.push(board)
      this.currentBoardId = board.id
      await window.api.boards.save(board)
      return board
    },
    async deleteBoard(id) {
      this.boards = this.boards.filter((b) => b.id !== id)
      if (this.currentBoardId === id) this.currentBoardId = this.boards[0]?.id ?? null
      await window.api.boards.delete(id)
    },
    async saveCurrent() {
      if (this.current) await window.api.boards.save(JSON.parse(JSON.stringify(this.current)))
    },
    setMode(mode) {
      this.mode = mode
      this.selectedButtonId = null
    },
    // ---- Bottoni ----
    findFreeCell(span = { rowSpan: 1, colSpan: 2 }) {
      const b = this.current
      if (!b) return null
      const occupied = new Set()
      b.buttons.forEach((btn) => {
        for (let r = btn.row; r < btn.row + btn.rowSpan; r++)
          for (let c = btn.col; c < btn.col + btn.colSpan; c++) occupied.add(`${r},${c}`)
      })
      for (let r = 1; r <= b.rows - span.rowSpan + 1; r++) {
        for (let c = 1; c <= b.cols - span.colSpan + 1; c++) {
          let free = true
          for (let rr = r; rr < r + span.rowSpan && free; rr++)
            for (let cc = c; cc < c + span.colSpan && free; cc++)
              if (occupied.has(`${rr},${cc}`)) free = false
          if (free) return { row: r, col: c }
        }
      }
      return null
    },
    async addButton(track, pos = null) {
      if (!this.current) return
      const span = { rowSpan: 1, colSpan: 2 }
      const cell = pos ?? this.findFreeCell(span)
      if (!cell) return
      // Un visual trascinato sulla griglia diventa un bottone di cast;
      // assegnando poi anche una traccia si ottiene una scena (audio + TV)
      const isVisual = track?.type === 'visual'
      const btn = {
        id: uid(),
        label: track?.title?.slice(0, 24) ?? 'Nuovo',
        trackId: isVisual ? null : track?.id ?? null,
        visualId: isVisual ? track.id : null,
        row: cell.row,
        col: cell.col,
        ...span
      }
      this.current.buttons.push(btn)
      this.selectedButtonId = btn.id
      await this.saveCurrent()
      return btn
    },
    async updateButton(id, patch) {
      const btn = this.current?.buttons.find((b) => b.id === id)
      if (!btn) return
      Object.assign(btn, patch)
      // Clamp dentro la griglia
      const b = this.current
      btn.row = Math.max(1, Math.min(btn.row, b.rows - btn.rowSpan + 1))
      btn.col = Math.max(1, Math.min(btn.col, b.cols - btn.colSpan + 1))
      btn.rowSpan = Math.max(1, Math.min(btn.rowSpan, b.rows - btn.row + 1))
      btn.colSpan = Math.max(1, Math.min(btn.colSpan, b.cols - btn.col + 1))
      await this.saveCurrent()
    },
    async removeButton(id) {
      if (!this.current) return
      this.current.buttons = this.current.buttons.filter((b) => b.id !== id)
      if (this.selectedButtonId === id) this.selectedButtonId = null
      await this.saveCurrent()
    }
  }
})
