
// https://github.com/parcel-bundler/parcel/issues/289#issuecomment-393106708
if (module.hot) module.hot.dispose(() => { window.location.reload(); throw new Error('Reloading') })

// tslint:disable:no-import-side-effect
import 'normalize.css'
import './style.styl'

import * as PIXI from 'pixi.js'

import { Book } from './factorio-data/book'
import BPString from './factorio-data/BPString'

import { InventoryContainer } from './panels/inventory'
import G from './common/globals'
import { EntityContainer } from './containers/entity'
import { EntityPaintContainer } from './containers/entityPaint'
import { BlueprintContainer } from './containers/blueprint'
import { ToolbarContainer } from './panels/toolbar'
import { QuickbarContainer } from './panels/quickbar'
import { Blueprint } from './factorio-data/blueprint'
import { EditEntityContainer } from './panels/editEntity'
import { InfoContainer } from './panels/info'
import FileSaver from 'file-saver'
import { TilePaintContainer } from './containers/tilePaint'
import initDoorbell from './doorbell'
import keyboard from './keyboard'
import initDatGui from './datgui'
import spritesheetsLoader from './spritesheetsLoader'

if (PIXI.utils.isMobile.any) {
    const text = 'This application is not compatible with mobile devices.'
    document.getElementById('loadingMsg').innerHTML = text
    throw new Error(text)
}

const params = window.location.search.slice(1).split('&')

G.renderOnly = params.includes('renderOnly')

let bpSource: string
let bpIndex = 0
for (const p of params) {
    if (p.includes('source')) {
        bpSource = p.split('=')[1]
    }
    if (p.includes('index')) {
        bpIndex = Number(p.split('=')[1])
    }
}

const { guiBPIndex, keybinds } = initDatGui()
initDoorbell()

G.app = new PIXI.Application({
    resolution: window.devicePixelRatio,
    roundPixels: true
    // antialias: true
})

// https://github.com/pixijs/pixi.js/issues/3928
G.app.renderer.plugins.interaction.moveWhenInside = true

G.app.renderer.autoResize = true
G.app.renderer.resize(window.innerWidth, window.innerHeight)
window.addEventListener('resize', () => {
    G.app.renderer.resize(window.innerWidth, window.innerHeight)
    G.BPC.zoomPan.setViewPortSize(G.app.screen.width, G.app.screen.height)
    G.BPC.zoomPan.updateTransform()
    G.BPC.updateViewportCulling()
}, false)
document.body.appendChild(G.app.view)

PIXI.settings.PRECISION_FRAGMENT = PIXI.PRECISION.HIGH
// PIXI.settings.SCALE_MODE = PIXI.SCALE_MODES.NEAREST
// PIXI.settings.GC_MODE = PIXI.GC_MODES.MANUAL
PIXI.Graphics.CURVES.adaptive = true

G.BPC = new BlueprintContainer()
G.app.stage.addChild(G.BPC)

G.editEntityContainer = new EditEntityContainer()
G.app.stage.addChild(G.editEntityContainer)

G.inventoryContainer = new InventoryContainer()
G.app.stage.addChild(G.inventoryContainer)

G.toolbarContainer = new ToolbarContainer()
G.app.stage.addChild(G.toolbarContainer)

G.quickbarContainer = new QuickbarContainer(G.quickbarRows)
G.app.stage.addChild(G.quickbarContainer)

const infoContainer = new InfoContainer()
G.app.stage.addChild(infoContainer)

Promise.all(
    [bpSource ? BPString.findBPString(bpSource) : undefined]
    .concat(spritesheetsLoader.getAllPromises())
)
.then(data => {
    // Load quickbarItemNames from localStorage
    if (localStorage.getItem('quickbarItemNames')) {
        const quickbarItemNames = JSON.parse(localStorage.getItem('quickbarItemNames'))
        G.quickbarContainer.generateSlots(quickbarItemNames)
    }

    if (!bpSource) {
        G.bp = new Blueprint()
        G.BPC.initBP()
        finishSetup()
    } else {
        loadBp(data[0], false).then(finishSetup)
    }

    function finishSetup() {
        G.BPC.centerViewport()

        G.gridData.update(window.innerWidth / 2, window.innerHeight / 2, G.BPC)

        G.loadingScreen.hide()
    }
})
.catch(error => console.error(error))

function loadBp(bpString: string, clearData = true) {
    return BPString.decode(bpString)
        .then(data => {

            if (data instanceof Book) {
                G.book = data
                G.bp = G.book.getBlueprint(bpIndex)

                guiBPIndex
                    .max(G.book.blueprints.length - 1)
                    .setValue(bpIndex)
            } else {
                G.book = undefined
                G.bp = data

                guiBPIndex
                    .setValue(0)
                    .max(0)
            }

            if (clearData) G.BPC.clearData()
            G.BPC.initBP()
            console.log('Loaded BP String')
        })
        .catch(error => console.error(error))
}

window.addEventListener('unload', () => G.app.destroy(true, true))

document.addEventListener('mousemove', e => {
    G.gridData.update(e.clientX, e.clientY, G.BPC)

    if (keyboard.pressing.movingViaWASD) return

    if (G.currentMouseState === G.mouseStates.PANNING) {
        G.BPC.zoomPan.translateBy(e.movementX, e.movementY)
        G.BPC.zoomPan.updateTransform()
        G.BPC.updateViewportCulling()
    }
})

document.addEventListener('copy', (e: ClipboardEvent) => {
    e.preventDefault()

    if (G.bp.isEmpty()) return

    if (navigator.clipboard && navigator.clipboard.writeText) {
        BPString.encode(G.bp)
            .then(s => navigator.clipboard.writeText(s))
            .then(() => console.log('Copied BP String'))
            .catch(error => console.error(error))
    } else {
        const data = BPString.encodeSync(G.bp)
        if (data.value) {
            e.clipboardData.setData('text/plain', data.value)
            console.log('Copied BP String')
        } else {
            console.error(data.error)
        }
    }
})

document.addEventListener('paste', (e: ClipboardEvent) => {
    e.preventDefault()

    G.loadingScreen.show()

    const promise = navigator.clipboard && navigator.clipboard.readText ?
        navigator.clipboard.readText() :
        Promise.resolve(e.clipboardData.getData('text'))

    promise
        .then(BPString.findBPString)
        .then(loadBp)
        .then(() => G.loadingScreen.hide())
        .catch(error => console.error(error))
})

keyboard.bind(keybinds.clear, () => {
    G.BPC.clearData()
    G.bp = new Blueprint()
    G.BPC.initBP()
})

keyboard.bind(keybinds.picture, () => {
    if (G.bp.isEmpty()) return

    G.BPC.enableRenderableOnChildren()
    if (G.renderOnly) G.BPC.cacheAsBitmap = false
    const texture = G.app.renderer.generateTexture(G.BPC)
    if (G.renderOnly) G.BPC.cacheAsBitmap = true
    G.BPC.updateViewportCulling()

    texture.frame = G.BPC.getBlueprintBounds()
    texture._updateUvs()

    G.app.renderer.plugins.extract.canvas(new PIXI.Sprite(texture)).toBlob((blob: Blob) => {
        FileSaver.saveAs(blob, G.bp.name + '.png')
        console.log('Saved BP Image')
    })
})

keyboard.bind(keybinds.overlay, () => {
    G.BPC.overlayContainer.overlay.visible = !G.BPC.overlayContainer.overlay.visible
})

keyboard.bind('i', () => infoContainer.toggle())

keyboard.bind(keybinds.closeWindow, () => { if (G.openedGUIWindow) G.openedGUIWindow.close() })

keyboard.bind(keybinds.inventory, () => {
    if (G.currentMouseState !== G.mouseStates.MOVING && !G.renderOnly) {
        if (G.openedGUIWindow) {
            G.openedGUIWindow.close()
        } else {
            G.inventoryContainer.toggle()
        }
    }
})

keyboard.bind(keybinds.focus, () => G.BPC.centerViewport())

keyboard.bind(keybinds.rotate, () => {
    if (G.BPC.hoverContainer &&
        (G.currentMouseState === G.mouseStates.NONE || G.currentMouseState === G.mouseStates.MOVING)
    ) {
        G.BPC.hoverContainer.rotate()
    } else if (G.currentMouseState === G.mouseStates.PAINTING) {
        G.BPC.paintContainer.rotate()
    }
})

keyboard.bind(keybinds.pippete, () => {
    if (G.BPC.hoverContainer && G.currentMouseState === G.mouseStates.NONE) {
        G.currentMouseState = G.mouseStates.PAINTING

        const hoverContainer = G.BPC.hoverContainer
        G.BPC.hoverContainer.pointerOutEventHandler()
        const entity = G.bp.entity(hoverContainer.entity_number)
        G.BPC.paintContainer = new EntityPaintContainer(entity.name,
            entity.directionType === 'output' ? (entity.direction + 4) % 8 : entity.direction,
            hoverContainer.position)
        G.BPC.paintContainer.moveAtCursor()
        G.BPC.addChild(G.BPC.paintContainer)
    } else if (G.currentMouseState === G.mouseStates.PAINTING) {
        G.BPC.paintContainer.destroy()
        G.BPC.paintContainer = undefined

        G.currentMouseState = G.mouseStates.NONE
    }
})

keyboard.bind(keybinds.increaseTileArea, () => {
    if (G.BPC.paintContainer instanceof TilePaintContainer) {
        G.BPC.paintContainer.increaseSize()
    }
})

keyboard.bind(keybinds.decreaseTileArea, () => {
    if (G.BPC.paintContainer instanceof TilePaintContainer) {
        G.BPC.paintContainer.decreaseSize()
    }
})

keyboard.bind(keybinds.undo, () => {
    G.bp.undo(
        hist => pre(hist, 'add'),
        hist => post(hist, 'del')
    )
})

keyboard.bind(keybinds.redo, () => {
    G.bp.redo(
        hist => pre(hist, 'del'),
        hist => post(hist, 'add')
    )
})

function pre(hist: IHistoryObject, addDel: string) {
    switch (hist.type) {
        case 'mov':
        case addDel:
            const e = EntityContainer.mappings.get(hist.entity_number)
            e.redrawSurroundingEntities()
            if (hist.type === addDel) {
                G.BPC.wiresContainer.remove(hist.entity_number)
                e.destroy()
            }
            if (hist.type === 'mov') G.BPC.wiresContainer.update(hist.entity_number)
    }
}

function post(hist: IHistoryObject, addDel: string) {
    function redrawEntityAndSurroundingEntities(entnr: number) {
        const e = EntityContainer.mappings.get(entnr)
        e.redraw()
        e.redrawSurroundingEntities()
    }
    switch (hist.type) {
        case 'mov':
            redrawEntityAndSurroundingEntities(hist.entity_number)
            const entity = G.bp.entity(hist.entity_number)
            const e = EntityContainer.mappings.get(hist.entity_number)
            e.position.set(
                entity.position.x * 32,
                entity.position.y * 32
            )
            e.updateVisualStuff()
            break
        case 'upd':
            if (hist.other_entity) {
                redrawEntityAndSurroundingEntities(hist.entity_number)
                redrawEntityAndSurroundingEntities(hist.other_entity)
            } else {
                const e = EntityContainer.mappings.get(hist.entity_number)
                e.redrawEntityInfo()
                redrawEntityAndSurroundingEntities(hist.entity_number)
                G.BPC.wiresContainer.update(hist.entity_number)
                if (G.editEntityContainer.visible) {
                    if (G.inventoryContainer.visible) G.inventoryContainer.close()
                    G.editEntityContainer.create(hist.entity_number)
                }
            }
            break
        case addDel:
            const ec = new EntityContainer(hist.entity_number)
            G.BPC.entities.addChild(ec)
            ec.redrawSurroundingEntities()
            G.BPC.wiresContainer.update(hist.entity_number)
    }

    console.log(`${addDel === 'del' ? 'Undo' : 'Redo'} ${hist.entity_number} ${hist.annotation}`)
    G.BPC.updateOverlay()
    G.BPC.updateViewportCulling()
}

keyboard.bind(keybinds.w, () => keyboard.pressing.w = true, () => keyboard.pressing.w = false)
keyboard.bind(keybinds.a, () => keyboard.pressing.a = true, () => keyboard.pressing.a = false)
keyboard.bind(keybinds.s, () => keyboard.pressing.s = true, () => keyboard.pressing.s = false)
keyboard.bind(keybinds.d, () => keyboard.pressing.d = true, () => keyboard.pressing.d = false)
keyboard.bind('shift', () => keyboard.pressing.shift = true, () => keyboard.pressing.shift = false)

keyboard.bind(keybinds.quickbarSlot01, () => G.quickbarContainer.bindKeyToSlot(0))
keyboard.bind(keybinds.quickbarSlot02, () => G.quickbarContainer.bindKeyToSlot(1))
keyboard.bind(keybinds.quickbarSlot03, () => G.quickbarContainer.bindKeyToSlot(2))
keyboard.bind(keybinds.quickbarSlot04, () => G.quickbarContainer.bindKeyToSlot(3))
keyboard.bind(keybinds.quickbarSlot05, () => G.quickbarContainer.bindKeyToSlot(4))
keyboard.bind(keybinds.quickbarSlot06, () => G.quickbarContainer.bindKeyToSlot(5))
keyboard.bind(keybinds.quickbarSlot07, () => G.quickbarContainer.bindKeyToSlot(6))
keyboard.bind(keybinds.quickbarSlot08, () => G.quickbarContainer.bindKeyToSlot(7))
keyboard.bind(keybinds.quickbarSlot09, () => G.quickbarContainer.bindKeyToSlot(8))
keyboard.bind(keybinds.quickbarSlot10, () => G.quickbarContainer.bindKeyToSlot(9))
keyboard.bind(keybinds.changeActiveQuickbar, () => G.quickbarContainer.changeActiveQuickbar())
