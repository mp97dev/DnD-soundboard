import { defineStore } from 'pinia'
import { useLibraryStore } from './library'
import { findFreeCell, clampToBounds } from '../grid'
import { t } from '../i18n'

let uid = () => Math.random().toString(36).slice(2, 10)

// Quante modifiche si possono annullare. Abbastanza per rimediare a una serie
// di gesti sbagliati, non tante da tenere in memoria un'intera sessione.
const MAX_UNDO = 50

export const useBoardsStore = defineStore('boards', {
  state: () => ({
    boards: [],
    currentBoardId: null,
    selectedButtonId: null,
    undoStack: [],
    redoStack: [],
    mode: 'play' // 'play' | 'edit'
  }),
  getters: {
    current: (s) => s.boards.find((b) => b.id === s.currentBoardId) ?? null,
    selectedButton() {
      return this.current?.buttons.find((b) => b.id === this.selectedButtonId) ?? null
    },
    // Quanti bottoni, su TUTTE le board e non solo su quella aperta, puntano a
    // queste tracce (come audio o come visual della scena).
    //
    // I bottoni tengono trackId/visualId, non una copia della traccia: tolta
    // la traccia dalla libreria il riferimento resta e il bottone si disegna
    // come «file mancante» / «nessuna traccia», su una board che magari si
    // riapre fra tre settimane a metà sessione. Questo conteggio esiste per
    // poterlo dire PRIMA di togliere, non per impedirlo.
    trackRefs: (s) => (ids) => {
      const wanted = new Set(ids)
      let buttons = 0
      const boards = new Set()
      for (const b of s.boards) {
        for (const btn of b.buttons || []) {
          if (
            (btn.trackId && wanted.has(btn.trackId)) ||
            (btn.visualId && wanted.has(btn.visualId))
          ) {
            buttons++
            boards.add(b.id)
          }
        }
      }
      return { buttons, boards: boards.size }
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
    // ---- Annulla / ripeti ----
    // Uno stack di istantanee dei bottoni della board corrente. Serve da
    // quando le misure si cambiano trascinando: prima si passava dai due campi
    // numerici, un gesto lento e difficile da sbagliare per caso; ora basta
    // partire col dito sulla maniglia sbagliata per rimpicciolire un bottone
    // che stava bene, e senza un modo di tornare indietro l'unica strada è
    // ricostruirlo a memoria a metà sessione.
    //
    // Si tiene l'istantanea PRIMA della modifica. Il limite esiste perché una
    // sessione di editing lunga non deve far crescere la memoria all'infinito.
    _snapshot() {
      return JSON.stringify(this.current?.buttons ?? [])
    },
    pushUndo() {
      if (!this.current) return
      this.undoStack.push(this._snapshot())
      if (this.undoStack.length > MAX_UNDO) this.undoStack.shift()
      // Un'azione nuova dopo un annulla taglia il futuro: tenere il redo
      // vorrebbe dire poter ripetere una modifica che parte da uno stato che
      // non esiste più.
      this.redoStack = []
    },
    async _restore(snapshot) {
      if (!this.current) return
      this.current.buttons = JSON.parse(snapshot)
      if (!this.current.buttons.some((b) => b.id === this.selectedButtonId)) {
        this.selectedButtonId = null
      }
      await this.saveCurrent()
    },
    async undo() {
      const prev = this.undoStack.pop()
      if (prev === undefined) return false
      this.redoStack.push(this._snapshot())
      await this._restore(prev)
      return true
    },
    async redo() {
      const next = this.redoStack.pop()
      if (next === undefined) return false
      this.undoStack.push(this._snapshot())
      await this._restore(next)
      return true
    },
    // ---- Bottoni ----
    findFreeCell(span = { rowSpan: 1, colSpan: 2 }) {
      const b = this.current
      if (!b) return null
      return findFreeCell(b.buttons, b.cols, b.rows, span.rowSpan, span.colSpan)
    },
    async addButton(track, pos = null) {
      if (!this.current) return
      const span = { rowSpan: 1, colSpan: 2 }
      const cell = pos ?? this.findFreeCell(span)
      if (!cell) return
      // Un visual trascinato sulla griglia diventa un bottone di cast;
      // assegnando poi anche una traccia si ottiene una scena (audio + TV)
      this.pushUndo()
      const isVisual = track?.type === 'visual'
      const btn = {
        id: uid(),
        // L'etichetta è un dato della board da qui in avanti: si traduce nel
        // momento in cui il bottone nasce e poi resta quella, come un titolo
        // scritto a mano. Cambiare lingua non riscrive le board già fatte.
        label: track?.title?.slice(0, 24) ?? t('button.newLabel'),
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
      this.pushUndo()
      Object.assign(btn, patch)
      // Clamp dentro i bordi. La collisione fra bottoni NON si controlla qui:
      // il chiamante ha già deciso (il trascinamento rifiuta il rilascio su
      // celle occupate), e un clamp silenzioso a sorpresa sarebbe peggio del
      // rifiuto esplicito.
      Object.assign(btn, clampToBounds(btn, this.current.cols, this.current.rows))
      await this.saveCurrent()
    },
    async removeButton(id) {
      if (!this.current) return
      this.pushUndo()
      this.current.buttons = this.current.buttons.filter((b) => b.id !== id)
      if (this.selectedButtonId === id) this.selectedButtonId = null
      await this.saveCurrent()
    }
  }
})
