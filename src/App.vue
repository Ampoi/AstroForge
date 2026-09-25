<script setup lang="ts">
import PartIcon from "./components/PartIcon.vue";
import ManualDemo from "./components/ManualDemo.vue";
import { PARTS } from "../shared/craft.ts";
import { useWorkshop, num, phase } from "./useWorkshop.ts";
const {
  sceneElement,
  helpDialog,
  craftDialog,
  vehicleMenu,
  craft,
  selected,
  symmetry,
  mirror,
  snap,
  connected,
  dirty,
  category,
  history,
  latest,
  name,
  pendingUdp,
  toastText,
  clock,
  globe,
  front,
  grid,
  markers,
  placement,
  sceneError,
  flying,
  active,
  stats,
  loose,
  issues,
  warning,
  validation,
  attached,
  palette,
  groupParts,
  stack,
  selection,
  vehicles,
  focused,
  udp,
  library,
  subtitle,
  hint,
  beginPart,
  dragPart,
  cancelPlacement,
  selectPart,
  removeSelected,
  adjust,
  setSymmetry,
  toggleMirror,
  toggleSnap,
  commitName,
  openEditor,
  launch,
  launchSaved,
  backToFlight,
  save,
  undo,
  reset,
  focusVehicle,
  toggleUdp,
  demoCommand,
  copyDemo,
  setTimeScale,
  setView,
  fit,
  fitSite,
  zoom,
  toggleGrid,
  toggleMarkers,
  openLibrary,
  movingIds,
  toast,
} = useWorkshop();
const categories = [
  ["all", "すべて"],
  ["propulsion", "推進"],
  ["electrical", "電源"],
  ["structure", "構造"],
];
function closeOnBackdrop(event: MouseEvent) {
  const dialog = event.currentTarget as HTMLDialogElement;
  if (event.target !== dialog) return;
  const r = dialog.getBoundingClientRect();
  if (
    event.clientX < r.left ||
    event.clientX > r.right ||
    event.clientY < r.top ||
    event.clientY > r.bottom
  )
    dialog.close();
}
</script>
<template>
  <div class="universal-clock" aria-label="GMT時刻">
    <span>GMT</span
    ><time id="gmt-clock" :datetime="clock.toISOString()">{{
      clock.toISOString().slice(11, 19)
    }}</time>
  </div>
  <div class="workspace">
    <aside id="parts-panel" class="left-panel" :hidden="flying">
      <div class="panel-heading">
        <div>
          <span class="eyebrow">COMPONENT LIBRARY</span>
          <h1>パーツライブラリ</h1>
        </div>
        <span class="count-badge">08</span>
      </div>
      <div class="category-tabs" aria-label="パーツ分類">
        <button
          v-for="[key, label] in categories"
          :key="key"
          :data-category="key"
          :class="{ active: category === key }"
          @click="category = key"
        >
          {{ label }}
        </button>
      </div>
      <div id="parts-list" class="parts-list">
        <button
          v-for="[type, def] in palette"
          :key="type"
          class="part-card"
          :data-part="type"
          draggable="true"
          :title="def.description"
          @click="beginPart(type)"
          @dragstart="dragPart($event, type)"
          @dragend="cancelPlacement"
        >
          <span class="part-art"><PartIcon :type="type" /></span
          ><span
            ><strong>{{ def.name }}</strong
            ><small>{{ def.label }}</small
            ><span class="part-meta"
              >{{ num(def.mass) }} kg{{
                def.thrust
                  ? ` · ${num(def.thrust / 1000, def.thrust < 1000 ? 2 : 0)} kN`
                  : def.fuel
                    ? ` · ${num(def.fuel)} kg fuel`
                    : def.power
                      ? ` · ${def.power} Wh`
                      : def.watts
                        ? ` · ${def.watts} W`
                        : ""
              }}</span
            ></span
          ><span class="part-add">+</span>
        </button>
      </div>
      <div class="library-foot">
        <span class="diameter-symbol">⌀</span>
        <div>
          <strong>共通径 1.25 m</strong>
          <p>面に取り付け、接続点の近くでスナップ</p>
        </div>
      </div>
    </aside>
    <main id="viewport" class="viewport">
      <div id="scene" ref="sceneElement" aria-label="ロケットの3D表示">
        <p v-if="sceneError" class="px-8 pt-56 text-orange-200">
          3D表示にはWebGLが必要です。ブラウザのハードウェアアクセラレーションを有効にして再読み込みしてください。
        </p>
      </div>
      <div class="scene-top">
        <div class="craft-title">
          <span id="scene-eyebrow" class="eyebrow">{{
            flying ? "FLIGHT OPERATIONS / EARTH" : "VEHICLE ASSEMBLY / BAY 01"
          }}</span
          ><input
            id="craft-name"
            v-model="name"
            maxlength="48"
            aria-label="機体名"
            :disabled="flying"
            @change="commitName"
          /><span id="craft-subtitle" class="craft-subtitle">{{
            subtitle
          }}</span>
        </div>
        <div class="scene-badge">
          <span class="status-dot" /><span id="scene-badge">{{
            flying ? "FLIGHT" : "ASSEMBLY"
          }}</span>
        </div>
      </div>
      <div id="build-toolbar" class="build-toolbar" :hidden="flying">
        <span>対称配置</span>
        <div id="symmetry" class="segmented">
          <button
            v-for="count in [1, 2, 4, 6]"
            :key="count"
            :data-symmetry="count"
            :class="{ active: !mirror && symmetry === count }"
            @click="setSymmetry(count)"
          >
            {{ count }}
          </button>
        </div>
        <button
          id="mirror-button"
          class="tool-button"
          :class="{ active: mirror }"
          title="左右に2個配置"
          @click="toggleMirror"
        >
          ↔ ミラー</button
        ><span class="toolbar-divider" /><button
          id="snap-button"
          class="snap-indicator"
          :aria-pressed="snap"
          title="近くの接続点へスナップ。Altキーで一時解除"
          @click="toggleSnap"
        >
          ⌖ スナップ {{ snap ? "ON" : "OFF" }}
        </button>
      </div>
      <div id="flight-actions" class="flight-actions" :hidden="!flying">
        <details id="vehicle-menu" ref="vehicleMenu" class="flight-menu">
          <summary>
            機体
            <span id="focus-name" :title="focused?.craft.name">{{
              focused?.craft.name
            }}</span
            ><span>⌄</span>
          </summary>
          <div class="flight-menu-content">
            <span class="eyebrow">CAMERA FOCUS · TAB TO SWITCH</span>
            <div id="vehicle-list">
              <div
                v-for="vehicle in vehicles"
                :key="vehicle.id"
                class="vehicle-row"
                :class="{ focused: vehicle.id === focused?.id }"
              >
                <div>
                  <strong :title="vehicle.craft.name">{{
                    vehicle.craft.name
                  }}</strong
                  ><small
                    >{{ phase[vehicle.status]
                    }}{{ vehicle.passive ? " · 分離物" : "" }}</small
                  >
                </div>
                <button
                  :data-focus="vehicle.id"
                  :disabled="vehicle.status === 'destroyed'"
                  :aria-pressed="vehicle.id === focused?.id"
                  @click="focusVehicle(vehicle.id)"
                >
                  {{ vehicle.id === focused?.id ? "追尾中" : "追尾" }}
                </button>
                <template v-if="!vehicle.passive"
                  ><button
                    class="udp-toggle"
                    role="switch"
                    :aria-checked="vehicle.udp.enabled"
                    :aria-label="`${vehicle.craft.name} のUDP制御`"
                    :data-control="vehicle.id"
                    :disabled="
                      pendingUdp.has(vehicle.id) ||
                      (!vehicle.controllable && !vehicle.udp.enabled)
                    "
                    @click="toggleUdp(vehicle.id)"
                  >
                    <span aria-hidden="true" />UDP
                    {{ vehicle.udp.enabled ? "ON" : "OFF" }}
                  </button>
                  <div
                    class="vehicle-udp"
                    :class="{ enabled: vehicle.udp.enabled }"
                  >
                    <template v-if="vehicle.udp.enabled"
                      ><code
                        >受信 :{{ vehicle.udp.commandPort }} · 送信 :{{
                          vehicle.udp.telemetryPort
                        }}</code
                      ><button
                        :data-copy-udp="vehicle.id"
                        title="この機体のデモ起動コマンドをコピー"
                        @click="copyDemo(vehicle.udp)"
                      >
                        接続コマンド ↗
                      </button></template
                    ><small v-else>{{
                      vehicle.controllable
                        ? "ONにすると専用ポートを割り当てます"
                        : "UDP制御できない機体です"
                    }}</small>
                  </div></template
                >
              </div>
            </div>
            <p>「追尾」でカメラを選択。UDPは複数機体をONにできます。</p>
            <button
              id="choose-craft-button"
              class="secondary-button"
              @click="openLibrary"
            >
              保存機体・プリセットを選ぶ
            </button>
          </div>
        </details>
        <button
          id="new-craft-button"
          class="floating-button"
          @click="openEditor()"
        >
          ＋ 新しい機体を作る
        </button>
      </div>
      <ManualDemo v-if="flying && focused && !focused.passive" :key="focused.id" :vehicle="focused" :connected="connected" @error="toast" />
      <div id="flight-toolbar" class="flight-toolbar" :hidden="!flying">
        <div class="segmented">
          <button
            id="view-follow"
            :class="{ active: !globe }"
            @click="setView(false)"
          >
            機体を追尾</button
          ><button
            id="view-earth"
            :class="{ active: globe }"
            @click="setView(true)"
          >
            地球全景
          </button>
        </div>
        <label class="time-scale-label"
          >時間倍率
          <select
            id="time-scale"
            :value="latest?.timeScale ?? 1"
            aria-label="シミュレーション速度"
            @change="setTimeScale"
          >
            <option v-for="scale in [1, 2, 5, 10]" :key="scale" :value="scale">
              ×{{ scale }}
            </option>
          </select></label
        ><button
          id="help-button"
          class="icon-button"
          aria-label="接続方法とヘルプ"
          @click="helpDialog?.showModal()"
        >
          ?</button
        ><a href="/docs/" target="_blank" rel="noopener" class="docs-button"
          >API ↗</a
        >
      </div>
      <button
        id="back-to-flight"
        class="floating-button back-to-flight"
        :hidden="flying"
        @click="backToFlight"
      >
        ← フライトへ戻る
      </button>
      <div id="orbit-legend" class="orbit-legend" :hidden="!globe">
        <span class="trail-key">実際の飛行軌跡</span
        ><span class="prediction-key">予測軌道 · 推力・空力なし</span>
      </div>
      <div
        id="placement-hint"
        class="placement-hint"
        :hidden="placement === false"
        :class="{ snapped: !!placement && placement.snapped }"
      >
        {{ hint }}
      </div>
      <div class="axis-widget" aria-hidden="true">
        <svg viewBox="0 0 75 75">
          <path
            d="M36 43V10M36 43 65 58M36 43 9 58"
            stroke-width="1.5"
            fill="none"
            stroke="#66828e"
          />
          <path d="M36 43V10" stroke="#8ce1bc" />
          <path d="M36 43 65 58" stroke="#e99a79" />
          <circle cx="36" cy="43" r="3" fill="#afc4cc" />
          <text x="32" y="8" fill="#8ce1bc">Y</text>
          <text x="64" y="68" fill="#e99a79">X</text>
          <text x="4" y="69" fill="#82b7e9">Z</text>
        </svg>
      </div>
      <div class="view-tools">
        <button
          id="view-iso"
          class="icon-button"
          :class="{ active: !front }"
          title="立体表示"
          aria-label="立体表示"
          @click="fit()"
        >
          ◈</button
        ><button
          id="view-front"
          class="icon-button"
          :class="{ active: front }"
          title="正面表示"
          aria-label="正面表示"
          @click="fit(true)"
        >
          ▣</button
        ><button
          id="view-site"
          :hidden="!flying || globe"
          class="icon-button"
          title="発射場全体を表示"
          aria-label="発射場全体を表示"
          @click="fitSite"
        >
          ⌂</button
        ><button
          id="view-fit"
          class="icon-button"
          title="機体全体を表示"
          aria-label="機体全体を表示"
          @click="fit()"
        >
          ⌗</button
        ><span /><button
          id="zoom-in"
          class="icon-button"
          aria-label="拡大"
          @click="zoom(0.8)"
        >
          +</button
        ><button
          id="zoom-out"
          class="icon-button"
          aria-label="縮小"
          @click="zoom(1.25)"
        >
          −</button
        ><button
          id="grid-button"
          :hidden="flying"
          class="icon-button"
          :class="{ active: grid }"
          title="グリッドを切り替え"
          aria-label="グリッドを切り替え"
          @click="toggleGrid"
        >
          ▦
        </button>
      </div>
      <div class="scene-bottom">
        <span id="view-instructions">{{
          flying
            ? globe
              ? "ドラッグで地球を回転 · スクロールで拡大・縮小"
              : "カメラ操作のみ · 飛行制御はUDPから"
            : "パーツをドラッグして子ごと移動 · 空白をドラッグで回転"
        }}</span
        ><button
          id="markers-button"
          class="text-button"
          :hidden="flying"
          :class="{ active: markers }"
          @click="toggleMarkers"
        >
          ◉ 重心 / 空力中心
        </button>
      </div>
      <div id="flight-hud" class="flight-hud" :hidden="!flying">
        <div class="hud-main">
          <span>ALTITUDE</span
          ><strong id="hud-altitude"
            ><template v-if="focused?.status === 'destroyed'">—</template
            ><template v-else
              >{{
                num(
                  (focused?.altitude ?? 0) >= 10000
                    ? focused!.altitude / 1000
                    : (focused?.altitude ?? 0),
                  (focused?.altitude ?? 0) >= 10000 ? 2 : 0,
                )
              }}<span>{{
                (focused?.altitude ?? 0) >= 10000 ? "km" : "m"
              }}</span></template
            ></strong
          >
        </div>
      </div>
    </main>
    <aside class="right-panel">
      <section id="editor-inspector" :hidden="flying">
        <div class="panel-heading">
          <div>
            <span class="eyebrow">VEHICLE OVERVIEW</span>
            <h2>機体構成</h2>
          </div>
          <span
            id="part-count"
            class="count-badge"
            :title="`接続 ${active.parts.length} 個 / 未接続 ${loose} 個`"
            >{{ String(active.parts.length).padStart(2, "0") }}</span
          >
        </div>
        <div class="design-summary">
          <div>
            <span>離陸時質量</span
            ><strong id="craft-mass"
              >{{ num(stats.mass) }}<small>kg</small></strong
            >
          </div>
          <div>
            <span>推力重量比</span
            ><strong
              id="craft-twr"
              :style="{
                color: stats.twr > 1 ? 'var(--cyan)' : 'var(--accent)',
              }"
              >{{ num(stats.twr, 2) }}</strong
            >
          </div>
        </div>
        <div class="small-stats">
          <div>
            <span>Δv / 真空</span
            ><strong id="craft-dv">{{ num(stats.deltaV) }} m/s</strong>
          </div>
          <div>
            <span>全長</span
            ><strong id="craft-height">{{ num(stats.height, 2) }} m</strong>
          </div>
        </div>
        <div class="section-caption">
          パーツ構成 <span>◆ ROOT / ◇ DETACHED</span>
        </div>
        <div id="stack-list" class="stack-list">
          <button
            v-for="{ part, depth } in stack"
            :key="part.id"
            class="stack-row"
            :class="{
              radial: depth > 0,
              selected: groupParts(part).some((p) => p.id === selected),
              detached: !attached.has(part.id),
            }"
            :data-select="part.id"
            @click="selectPart(part.id)"
          >
            <span class="stack-symbol">{{
              part.id === craft.rootId ? "◆" : !part.parent ? "◇" : "↳"
            }}</span
            >{{ PARTS[part.type].name
            }}<span>{{
              groupParts(part).length > 1
                ? `×${groupParts(part).length}`
                : attached.has(part.id)
                  ? `${num(PARTS[part.type].mass)} kg`
                  : "未接続"
            }}</span>
          </button>
          <p v-if="!stack.length" class="empty-assembly">
            パーツを選んで作業場に配置すると、最初のルートになります。
          </p>
        </div>
        <div id="selection-inspector" class="selection-inspector">
          <template v-if="selection"
            ><span class="eyebrow">{{ PARTS[selection.type].label }}</span>
            <div class="selected-part-name">
              {{ PARTS[selection.type].name
              }}{{
                groupParts(selection).length > 1
                  ? ` ×${groupParts(selection).length}`
                  : ""
              }}
            </div>
            <p class="part-description">
              {{
                selection.id === craft.rootId
                  ? "◆ ルートパーツ"
                  : attached.has(selection.id)
                    ? "接続済み"
                    : "◇ 未接続 · 機体の集計・保存・発射から除外"
              }}{{
                movingIds(craft, selection.id).size > 1
                  ? ` · 子パーツ ${movingIds(craft, selection.id).size - 1} 個と一緒に移動`
                  : ""
              }}
            </p>
            <template v-if="PARTS[selection.type].radial && selection.parent"
              ><label class="position-control"
                >上下位置<input
                  id="part-offset"
                  type="range"
                  min="-0.5"
                  max="0.5"
                  step="0.001"
                  :value="selection.offset"
                  aria-label="取り付け高さ"
                  @change="
                    adjust(
                      Number(($event.target as HTMLInputElement).value),
                      selection.angle!,
                    )
                  " /></label
              ><label class="position-control"
                >回転角度<input
                  id="part-angle"
                  type="range"
                  min="0"
                  max="360"
                  step="1"
                  :value="
                    Math.round(
                      ((((selection.angle ?? 0) + Math.PI * 2) %
                        (Math.PI * 2)) *
                        180) /
                        Math.PI,
                    )
                  "
                  aria-label="側面パーツの回転角度"
                  @change="
                    adjust(
                      selection.offset!,
                      (Number(($event.target as HTMLInputElement).value) *
                        Math.PI) /
                        180,
                    )
                  " /></label
            ></template>
            <div class="selection-actions">
              <button id="part-duplicate" @click="beginPart(selection.type)">
                同じパーツを追加</button
              ><button
                v-if="selection.id !== craft.rootId"
                id="part-delete"
                class="delete"
                @click="removeSelected"
              >
                子パーツごと削除
              </button>
            </div></template
          ><template v-else
            ><span class="eyebrow">PART INSPECTOR</span>
            <p>
              機体のパーツを選択すると<br />取り付け位置を調整できます。
            </p></template
          >
        </div>
        <div id="validation" class="validation" :class="{ warning }">
          {{ validation }}
        </div>
        <button
          id="two-stage-button"
          class="two-stage-button"
          @click="reset('two-stage')"
        >
          ⊟ 2段機体で分離を試す
        </button>
        <div class="editor-actions">
          <div class="secondary-actions">
            <button
              id="save-button"
              :disabled="!connected || !active.parts.length"
              @click="save"
            >
              保存</button
            ><button
              id="undo-button"
              :disabled="!history.length"
              title="元に戻す (⌘Z)"
              @click="undo"
            >
              ↶ 戻す</button
            ><button id="reset-button" @click="reset('starter')">1段機体</button
            ><button id="empty-button" @click="reset('empty')">空にする</button>
          </div>
          <button
            id="launch-button"
            class="primary-button"
            :disabled="!connected || !!issues.length"
            @click="launch"
          >
            <span>発射台へ</span><span>↗</span>
          </button>
          <p>
            別ターミナルで
            <code data-demo-command>{{
              demoCommand() ?? "機体一覧でUDPをONにしてください"
            }}</code>
            を実行して点火
          </p>
        </div>
      </section>
      <div class="udp-card">
        <div class="udp-heading">
          <span
            id="udp-dot"
            class="status-dot"
            :class="{ off: !udp?.enabled || udp.authority?.state === 2 }"
          /><strong>PyLoN UDP</strong
          ><span id="udp-state">{{
            !udp?.enabled
              ? "OFF"
              : udp.authority?.state === 2
                ? "緊急停止"
                : udp.authority?.state === 1
                  ? "制御中"
                  : "待機中"
          }}</span>
        </div>
        <div class="endpoint">
          <span>RX COMMAND</span
          ><code id="rx-port">{{
            udp?.enabled ? `:${udp.commandPort}` : "—"
          }}</code>
        </div>
        <div class="endpoint">
          <span>TX TELEMETRY</span
          ><code id="tx-port">{{
            udp?.enabled ? `:${udp.telemetryPort}` : "—"
          }}</code>
        </div>
        <div class="udp-foot">
          <span id="packet-count"
            >{{ num(udp?.received ?? 0) }} RX ·
            {{ num(udp?.sent ?? 0) }} TX</span
          ><button
            id="connect-button"
            class="text-button"
            @click="helpDialog?.showModal()"
          >
            接続方法 ↗
          </button>
        </div>
      </div>
    </aside>
  </div>
  <footer class="statusbar">
    <div>
      <span class="status-dot" /><span>LOCAL SIMULATION</span><b>/</b
      ><span id="footer-planet">EARTH · 1:1 SCALE</span>
    </div>
    <div>
      <span id="performance-label"
        >PHYSICS 120 Hz · {{ num(latest?.connection.physicsMs, 2) }} ms</span
      ><b>/</b><span>TELEMETRY 20 Hz</span><b>/</b
      ><span id="save-state">{{ dirty ? "未保存" : "保存済み" }}</span
      ><span
        id="connection-dot"
        class="status-dot"
        :class="{ off: !connected }"
      /><span id="connection-label">{{
        connected ? "ローカル接続" : "再接続中"
      }}</span>
    </div>
  </footer>
  <div id="toast" role="status" aria-live="polite" :hidden="!toastText">
    {{ toastText }}
  </div>
  <dialog id="help-dialog" ref="helpDialog" @click="closeOnBackdrop">
    <div class="dialog-heading">
      <div>
        <span class="eyebrow">QUICK START</span>
        <h2>組み立てて、コードで飛ばす。</h2>
      </div>
      <button
        id="close-help"
        class="icon-button"
        aria-label="閉じる"
        @click="helpDialog?.close()"
      >
        ×
      </button>
    </div>
    <div class="help-steps">
      <div>
        <span>01</span>
        <p>
          <strong>ロケットを組み立てる</strong
          >最初の胴体パーツを配置してルートを作成。接続点に近づけるとスナップします。ドラッグで子パーツも一緒に移動し、未接続のパーツは半透明になります。半透明のパーツは集計・保存・発射に含まれません。Escで取消、⌘Zで元に戻せます。
        </p>
      </div>
      <div>
        <span>02</span>
        <p>
          <strong>発射台に配置する</strong
          >「発射台へ」を押し、機体一覧でUDPをONにします。⌂ボタンで発射場と周辺施設を見渡せます。
        </p>
      </div>
      <div>
        <span>03</span>
        <p>
          <strong>UDPでフライトを制御する</strong
          >次のコマンドを別ターミナルで実行すると点火・姿勢制御を行います。2段機体は燃料切れで下段を切り離し、上段を点火します。「地球全景」で飛行履歴と予測軌道を確認できます。
        </p>
      </div>
    </div>
    <div class="command-box">
      <code data-demo-command>{{
        demoCommand() ?? "機体一覧でUDPをONにしてください"
      }}</code
      ><button id="copy-demo" :disabled="!udp?.enabled" @click="copyDemo()">
        コピー
      </button>
    </div>
    <p class="help-note">
      独立したUDPクライアントです。テレメトリ受信・操縦判断・ログはデモ内で完結します。Ctrl+Cで推力を切り、制御権を返します。
    </p>
    <div class="help-spec">
      <span>JSON / UTF-8</span
      ><span id="help-rx"
        >RX {{ udp?.enabled ? `:${udp.commandPort}` : "—" }}</span
      ><span id="help-tx"
        >TX {{ udp?.enabled ? `:${udp.telemetryPort}` : "—" }}</span
      ><span>PyLoN v1 subset</span>
    </div>
    <a class="doc-link" href="/docs/" target="_blank" rel="noopener"
      >APIドキュメントを開く ↗</a
    >
    <p class="help-note">
      空力は標準大気と係数による近似。分離リングで多段化でき、分離後も上段を制御できます。
    </p>
  </dialog>
  <dialog id="craft-dialog" ref="craftDialog" @click="closeOnBackdrop">
    <div class="dialog-heading">
      <div>
        <span class="eyebrow">VEHICLE LIBRARY</span>
        <h2>機体を選ぶ</h2>
      </div>
      <button
        id="close-craft-dialog"
        class="icon-button"
        aria-label="機体選択を閉じる"
        @click="craftDialog?.close()"
      >
        ×
      </button>
    </div>
    <p class="help-note">
      保存した機体とプリセット。飛行中の機体を残したまま、次の機体を配置できます。
    </p>
    <div id="craft-library" class="craft-library">
      <div v-for="entry in library" :key="entry.id" class="library-entry">
        <div>
          <span class="eyebrow">{{
            ["starter", "two-stage"].includes(entry.id)
              ? "PRESET"
              : "SAVED VEHICLE"
          }}</span
          ><strong>{{ entry.craft.name }}</strong>
          <p>
            {{ entry.craft.parts.length }} パーツ ·
            {{ entry.stats.stageCount }} 段 · {{ num(entry.stats.mass) }} kg
          </p>
        </div>
        <div class="flex gap-2">
          <button :data-edit-craft="entry.id" @click="openEditor(entry.id)">
            VABで編集</button
          ><button
            :data-launch-craft="entry.id"
            class="library-launch"
            @click="launchSaved(entry.id)"
          >
            発射台へ ↗
          </button>
        </div>
      </div>
    </div>
  </dialog>
</template>
