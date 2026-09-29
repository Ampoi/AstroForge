import type {MapFocus} from './solar-map.ts';
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  watch,
} from "vue";
import {
  PARTS,
  starterCraft,
  twoStageCraft,
  roverCraft,
  isRover,
  validateCraft,
  craftStats,
  launchIssues,
} from "../shared/craft.ts";
import {
  emptyAssembly,
  toAssembly,
  restoreAssembly,
  connectedIds,
  movingIds,
  assembledCraft,
  assemblyStats,
  placeAssembly,
  removeAssembly,
  resolveAssemblyPlacement,
} from "../shared/assembly.ts";
import type {
  Craft,
  Assembly,
  AssemblyPart,
  AssemblyPlacement,
  Mode,
  PartType,
} from "../shared/types.ts";
import type { AppState, ApiRoutes } from "../shared/api.ts";
import {LAUNCH_SITES} from "../shared/launch-sites.ts";
import type {LaunchSiteId, LaunchPreview} from "../shared/launch-sites.ts";
import {StateStreamDecoder, type StreamFrame} from '../shared/state-stream.ts';
import {attachmentFace,faceLabel,matchingFaces} from '../shared/attachment.ts';
import { errorMessage } from "../shared/errors.ts";
import { afterPaint, createLoadingProgress, type LoadingReporter } from "./loading.ts";
import { RocketScene } from "./scene.ts";
import { defaultPartInfoSettings, restorePartInfoSettings } from './part-info.ts';
import { PartController } from './part-controls.ts';
import { frameRate, frameRates, type FrameRate } from "./display.ts";

export const num = (value: number | null | undefined, digits = 0) =>
  typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("en-US", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
    : "—";
export const phase = {
  pad: "発射待機",
  flying: "飛行中",
  landed: "着地",
  crashed: "停止",
  destroyed: "破損・消失",
};
export async function api<K extends keyof ApiRoutes>(
  path: K,
  data: ApiRoutes[K]["input"],
): Promise<ApiRoutes[K]["output"]> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const result: unknown = await res.json();
  if (!res.ok)
    throw Error(
      result && typeof result === "object" && "error" in result
        ? String(result.error)
        : `HTTP ${res.status}`,
    );
  return result as ApiRoutes[K]["output"];
}
export function useWorkshop() {
  const loading = ref({active:true,progress:0,label:'パーツモデルとサムネイルを準備しています',error:''});
  const updateLoading = createLoadingProgress();
  const reportLoading:LoadingReporter = (stage, progress) => {
    if (loading.value.active && !loading.value.error) Object.assign(loading.value, updateLoading(stage, progress));
  };
  const reload = () => window.location.reload();
  let disposed = false;

  const partController = new PartController(`gui-${crypto.randomUUID()}`, crypto.randomUUID());
  const partInfoSettings = ref({ ...defaultPartInfoSettings });
  const displayRate = ref<FrameRate>('display'), renderFps = ref(0);
  const sceneElement = ref<HTMLElement>(),
    helpDialog = ref<HTMLDialogElement>(),
    craftDialog = ref<HTMLDialogElement>(),
    launchDialog = ref<HTMLDialogElement>(),
    vehicleMenu = ref<HTMLDetailsElement>();
  const craft = shallowRef<Assembly>(toAssembly(twoStageCraft())),
    selected = ref<string | null>(null),
    symmetry = ref(4),
    mirror = ref(false),
    snap = ref(true);
  const mode = ref<Mode>("flight"),
    connected = ref(false),
    dirty = ref(false),
    category = ref("all"),
    history = shallowRef<Assembly[]>([]);
  const latest = shallowRef<AppState | null>(null),
    focusId = ref<string | null>(null),
    libraryId = ref<string | null>(null),
    name = ref(craft.value.name);
  const pendingUdp = ref(new Set<string>()),
    toastText = ref(""),
    // GMT follows the world's elapsed game time, starting at 00:00:00.
    clock = computed(() => new Date((latest.value?.simulationTime ?? 0) * 1000)),
    globe = ref(false),
    mapFocus = ref<MapFocus>("earth"),
    mapPredictionStatus = ref("軌道を計算中…"),
    front = ref(false),
    grid = ref(true),
    markers = ref(false);
  const preview = shallowRef<Assembly | null>(null),
    placement = shallowRef<AssemblyPlacement | null | false | undefined>(false),
    sceneError = ref(false);
  let scene: RocketScene | undefined,
    stream: EventSource | undefined,
    fpsTimer: ReturnType<typeof setInterval>,
    toastTimer: ReturnType<typeof setTimeout>;
  let initial = true;
  const flying = computed(() => mode.value === "flight");
  const active = computed(() => assembledCraft(preview.value ?? craft.value)),
    stats = computed(() => assemblyStats(preview.value ?? craft.value));
  const loose = computed(
    () =>
      (preview.value ?? craft.value).parts.length - active.value.parts.length,
  );
  const issues = computed(() =>
    active.value.parts.length
      ? launchIssues(active.value)
      : ["最初のルートパーツを配置してください"],
  );
  const warning = computed(
    () => !!issues.value.length || (!isRover(active.value) && stats.value.stability < 0),
  );
  const validation = computed(() =>
    issues.value.length
      ? "△ " + issues.value[0]
      : (!isRover(active.value) && stats.value.stability < 0)
        ? "△ 空力中心が重心より前方です。翼を下方に追加すると安定します。"
        : isRover(active.value) ? "✓ 走行準備OK · 車輪ごとにUDPで駆動・操舵・制動" : `✓ 発射準備OK · 静安定余裕 ${num(stats.value.stability, 1)} 口径（概算）`,
  );
  const attached = computed(() => connectedIds(craft.value));
  const palette = computed(
    () =>
      Object.entries(PARTS).filter(
        ([, d]) => category.value === "all" || d.category === category.value,
      ) as [PartType, (typeof PARTS)[PartType]][],
  );
  const groupParts = (p: AssemblyPart) =>
    p.group ? craft.value.parts.filter((c) => c.group === p.group) : [p];
  const stack = computed(() => {
    const rows: { part: AssemblyPart; depth: number }[] = [],
      seen = new Set<string>();
    function visit(part: AssemblyPart, depth: number) {
      if (seen.has(part.id)) return;
      for (const p of groupParts(part)) seen.add(p.id);
      rows.push({ part, depth });
      for (const child of craft.value.parts.filter((c) => c.parent === part.id))
        visit(child, depth + 1);
    }
    const root = craft.value.parts.find((p) => p.id === craft.value.rootId);
    if (root) visit(root, 0);
    for (const part of craft.value.parts) if (!part.parent) visit(part, 0);
    for (const part of craft.value.parts) visit(part, 0);
    return rows;
  });
  const selection = computed(() =>
    craft.value.parts.find((p) => p.id === selected.value),
  );
  const vehicles = computed(() => latest.value?.vehicles ?? []);
  const focused = computed(() =>
    vehicles.value.find((v) => v.id === focusId.value),
  );
  const udp = computed(
    () =>
      vehicles.value.find(
        (v) =>
          v.id ===
          (flying.value ? focusId.value : latest.value?.activeVehicleId),
      )?.udp,
  );
  const library = computed(() =>
    (latest.value?.library ?? []).map((entry) => ({
      ...entry,
      stats: craftStats(entry.craft),
    })),
  );
  const subtitle = computed(() =>
    flying.value
      ? `${focused.value?.wheels.length ? "地表走行" : focused.value ? phase[focused.value.status] : ""} · パーツを選択して操作 / UDP制御`
      : craft.value.rootId
        ? `接続 ${active.value.parts.length} 個 · 未接続 ${loose.value} 個 · 子パーツごとドラッグ`
        : "最初のパーツを配置してルートを作成",
  );
  const hint = computed(() =>
    placement.value === false
      ? ""
      : placement.value?.kind === "root"
        ? "◆ ルートを配置 · 子パーツも一緒に移動"
        : placement.value?.kind === "free"
          ? "未接続 · 半透明のパーツは機体に含まれません · Escで取消"
          : placement.value?.kind === "stack"
            ? stackHint(placement.value)
          : placement.value?.snapped
            ? "⌖ 接続点にスナップ · 離して接続"
            : placement.value?.kind === "surface"
              ? "側面に取り付け · 離して確定"
              : placement.value === null
                ? "この位置には配置できません"
                : "パーツを配置 · 断面を近づけて重ねるとスナップ · Escで取消",
  );
  function stackHint(value: Extract<AssemblyPlacement,{kind:'stack'}>) {
    const target=craft.value.parts.find(p=>p.id===value.parent),type=scene?.placing;
    if(!target||!type)return '⌖ 断面にスナップ · 離して接続';
    const face=attachmentFace(target.type,value.side)!,incoming=attachmentFace(type,-value.side)!;
    return `⌖ ${faceLabel(face)} · ${matchingFaces(face,incoming)?'同じ規格':'異径接続OK'} · 離して接続`;
  }
  function toast(message: string) {
    toastText.value = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastText.value = ""), 4000);
  }
  function stash() {
    history.value = [...history.value.slice(-49), structuredClone(craft.value)];
  }
  function changed() {
    dirty.value = true;
    name.value = craft.value.name;
    try {
      localStorage.setItem("astroforge-draft", JSON.stringify(craft.value));
    } catch {}
    scene?.setCraft(craft.value);
    scene?.select(selected.value);
  }
  function selectPart(id: string | null) {
    selected.value = id;
    scene?.select(id);
  }
  function canPlace(type: PartType) {
    if (flying.value) return false;
    if (!craft.value.rootId && PARTS[type].radial) {
      toast("最初にポッドや燃料タンクなどの胴体パーツを配置してください");
      return false;
    }
    return true;
  }
  function beginPart(type: PartType) {
    if(type === "wheel" && symmetry.value > 2)setSymmetry(2);
    if (canPlace(type))
      scene?.setPlacement(type, {
        count: symmetry.value,
        mirror: mirror.value,
        snap: snap.value,
      });
  }
  function dragPart(event: DragEvent, type: PartType) {
    if (!canPlace(type) || !event.dataTransfer) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData("text/part", type);
    event.dataTransfer.effectAllowed = "copy";
    beginPart(type);
  }
  function cancelPlacement() {
    scene?.cancelPlacement();
    preview.value = null;
    placement.value = false;
  }
  function placePart(
    type: PartType,
    where: AssemblyPlacement | null,
    movingId?: string,
  ) {
    if (!where || (!movingId && !canPlace(type))) return;
    try {
      const next = placeAssembly(craft.value, type, where, {
        movingId,
        count: symmetry.value,
        mirror: mirror.value,
        idFactory: (prefix) => `${prefix}_${crypto.randomUUID().slice(0, 8)}`,
      });
      stash();
      craft.value = next;
      selected.value =
        movingId ??
        next.parts.find(
          (p) => !history.value.at(-1)?.parts.some((c) => c.id === p.id),
        )?.id ??
        null;
      cancelPlacement();
      changed();
    } catch (error) {
      toast(errorMessage(error));
    }
  }
  function removeSelected() {
    if (!selected.value || selected.value === craft.value.rootId) return;
    stash();
    cancelPlacement();
    craft.value = removeAssembly(craft.value, selected.value);
    selected.value = null;
    changed();
  }
  function adjust(offset: number, angle: number) {
    const p = selection.value,
      parent = craft.value.parts.find((c) => c.id === p?.parent);
    if (!p || !parent) return;
    const hit = {
      id: parent.id,
      point: [
        parent.position[0] + offset * PARTS[parent.type].height,
        parent.position[1] + Math.cos(angle),
        parent.position[2] + Math.sin(angle),
      ],
      normal: [0, Math.cos(angle), Math.sin(angle)],
    };
    const where = resolveAssemblyPlacement(craft.value, p.type, hit, {
      movingId: p.id,
      snap: false,
    });
    stash();
    craft.value = placeAssembly(craft.value, p.type, where, { movingId: p.id });
    changed();
  }
  function setSymmetry(count: number) {
    symmetry.value = count;
    mirror.value = false;
    scene?.setPlacement(scene.placing, { count, mirror: false });
  }
  function toggleMirror() {
    mirror.value = !mirror.value;
    scene?.setPlacement(scene.placing, {
      count: symmetry.value,
      mirror: mirror.value,
    });
  }
  function toggleSnap() {
    snap.value = !snap.value;
    scene?.setPlacement(scene.placing, { snap: snap.value });
  }
  function commitName() {
    const value = name.value.trim();
    if (!value) {
      name.value = craft.value.name;
      return;
    }
    if (value !== craft.value.name) {
      stash();
      craft.value = { ...craft.value, name: value };
      changed();
    }
  }
  function updateScene() {
    if (!scene || !latest.value) return;
    if (flying.value) {
      const visible = vehicles.value.filter((v) => v.status !== "destroyed");
      let f = visible.find((v) => v.id === focusId.value);
      f ??=
        visible.find((v) => v.id.startsWith(`${focusId.value}/`)) ??
        visible.find((v) => v.id === latest.value!.activeVehicleId) ??
        visible[0] ??
        vehicles.value.find((v) => v.id === latest.value!.activeVehicleId);
      if (!f) return;
      if (focusId.value !== f.id) selectPart(null);
      focusId.value = f.id;
      if(mapFocus.value.startsWith("vehicle:")&&!vehicles.value.some(v=>`vehicle:${v.id}`===mapFocus.value&&v.status!=="destroyed"))setMapFocus("earth");
      if (selected.value && !f.craft.parts.some(p => p.id === selected.value)) selectPart(null);
      const signature = JSON.stringify(f.craft);
      if (scene.craftSignature !== signature) {
        scene.setCraft(f.craft);
        scene.craftSignature = signature;
        scene.select(selected.value);
      }
      name.value = f.craft.name;
      scene.updateFlight(
        {
          ...f,
          debris: vehicles.value
            .filter((v) => v.id !== f.id && v.status !== "destroyed")
            .map((v) => ({ ...v, debris: [] })),
        },
        f.trail,
      );
    }
  }
  function applyState(state: AppState) {
    latest.value = state;
    if (initial || mode.value !== state.mode) {
      cancelPlacement();
      craft.value = toAssembly(
        state.mode === "editor" ? state.draft : state.craft,
      );
      if (initial && state.mode === "editor")
        try {
          const draft = localStorage.getItem("astroforge-draft");
          if (draft) {
            craft.value = restoreAssembly(JSON.parse(draft));
            dirty.value =
              JSON.stringify(craft.value) !==
              JSON.stringify(toAssembly(state.draft));
          }
        } catch {}
      mode.value = state.mode;
      selected.value = null;
      name.value = craft.value.name;
      globe.value = false;
      scene?.setCraft(craft.value);
      scene?.setMode(mode.value);
      if (scene) scene.craftSignature = null;
      void nextTick(() => {
        scene?.resize();
        scene?.fit();
      });
      initial = false;
    }
    updateScene();
  }
  async function openEditor(id?: string) {
    try {
      const state = await api("/api/editor", id ? { libraryId: id } : {});
      libraryId.value =
        id && !["starter", "two-stage", "rover"].includes(id) ? id : null;
      history.value = [];
      dirty.value = false;
      applyState(state);
      craft.value = toAssembly(state.draft);
      try {
        localStorage.setItem("astroforge-draft", JSON.stringify(craft.value));
      } catch {}
      name.value = craft.value.name;
      selected.value = null;
      cancelPlacement();
      scene?.setCraft(craft.value);
      scene?.fit();
      craftDialog.value?.close();
    } catch (error) {
      toast(errorMessage(error));
    }
  }
  const launchCraft = shallowRef<Craft | null>(null);
  const launchSite = ref<LaunchSiteId>('pad');
  const launchPreview = shallowRef<LaunchPreview | null>(null);
  const launchBusy = ref(false), launchChecking = ref(false), recoverOccupants = ref(false), launchError = ref('');
  let previewRequest = 0;
  async function refreshLaunchPreview() {
    const request = ++previewRequest;
    launchPreview.value = null;
    recoverOccupants.value = false;
    launchError.value = '';
    if (!launchCraft.value) return;
    launchChecking.value = true;
    try {
      const result = await api('/api/launch-preview', {...launchCraft.value, site: launchSite.value});
      if (request === previewRequest) launchPreview.value = result;
    } catch (error) {
      if (request === previewRequest) launchError.value = errorMessage(error);
    } finally {
      if (request === previewRequest) launchChecking.value = false;
    }
  }
  const canLaunch = computed(() => !launchBusy.value && !launchChecking.value && !!launchPreview.value &&
    (!launchPreview.value.occupants.length || recoverOccupants.value && launchPreview.value.occupants.every(v => v.recoverable)));
  function chooseLaunch(next: Craft) {
    launchCraft.value = structuredClone(next);
    launchSite.value = isRover(next) ? 'ground' : 'pad';
    craftDialog.value?.close();
    launchDialog.value?.showModal();
    void refreshLaunchPreview();
  }
  function launch() {
    try {
      commitName();
      cancelPlacement();
      chooseLaunch(validateCraft(assembledCraft(craft.value)));
    } catch (error) { toast(errorMessage(error)); }
  }
  function launchSaved(id: string) {
    const entry = latest.value?.library.find(v => v.id === id);
    if (entry) chooseLaunch(entry.craft);
  }
  async function confirmLaunch() {
    if (!canLaunch.value || !launchCraft.value || !launchPreview.value) return;
    launchBusy.value = true;
    try {
      const state = await api('/api/launch', {...launchCraft.value, site: launchSite.value,
        recoverVehicleIds: recoverOccupants.value ? launchPreview.value.occupants.map(v => v.id) : []});
      focusId.value = state.activeVehicleId;
      applyState(state);
      scene?.fit();
      launchDialog.value?.close();
      window.scrollTo({top: 0, behavior: 'smooth'});
      toast(`${LAUNCH_SITES[launchSite.value].label}に配置しました。機体一覧でUDPをONにすると接続できます`);
    } catch (error) {
      const message = errorMessage(error);
      await refreshLaunchPreview();
      launchError.value = message;
    } finally { launchBusy.value = false; }
  }
  async function backToFlight() {
    try {
      applyState(await api("/api/flight", {}));
    } catch (error) {
      toast(errorMessage(error));
    }
  }
  async function save() {
    try {
      commitName();
      const saved = await api("/api/craft", {
        ...validateCraft(assembledCraft(craft.value)),
        libraryId: libraryId.value,
      });
      libraryId.value = saved.libraryId;
      if (latest.value)
        latest.value = { ...latest.value, library: saved.library };
      dirty.value = false;
      toast("機体をローカルに保存しました");
    } catch (error) {
      toast(errorMessage(error));
    }
  }
  function undo() {
    const prior = history.value.at(-1);
    if (!prior || flying.value) return;
    cancelPlacement();
    history.value = history.value.slice(0, -1);
    craft.value = prior;
    selected.value = null;
    changed();
  }
  function reset(kind: "starter" | "two-stage" | "rover" | "empty") {
    stash();
    cancelPlacement();
    libraryId.value = null;
    craft.value =
      kind === "empty"
        ? emptyAssembly()
        : toAssembly(kind === "starter" ? starterCraft() : kind === "rover" ? roverCraft() : twoStageCraft());
    selected.value = null;
    changed();
    scene?.fit();
  }
  function focusVehicle(id: string) {
    if (focusId.value !== id) selectPart(null);
    focusId.value = id;
    updateScene();
    setMapFocus(`vehicle:${id}`);
    scene?.fit();
  }
  async function toggleUdp(id: string) {
    const vehicle = vehicles.value.find((v) => v.id === id);
    if (!vehicle || pendingUdp.value.has(id)) return;
    pendingUdp.value.add(id);
    try {
      const enabled = !vehicle.udp.enabled;
      applyState(await api("/api/control", { vehicleId: id, enabled }));
      toast(
        enabled
          ? "UDP ON · 接続コマンドから起動できます"
          : "UDP OFF · この機体の指令と制御権を解除しました",
      );
    } catch (error) {
      toast(errorMessage(error));
    } finally {
      pendingUdp.value.delete(id);
    }
  }
  async function sendPartCommand(command: Record<string, unknown>) {
    const vehicle = focused.value, session = vehicle?.udp.session, partId = selected.value;
    if (!vehicle || !session) throw Error('UDPを有効にしてから操作してください');
    const isCurrent = () => connected.value && flying.value && focused.value?.id === vehicle.id &&
      selected.value === partId && focused.value?.udp.session?.runtimeEpoch === session.runtimeEpoch;
    await partController.send(session, command,
      command => api('/api/part-command', {vehicleId:vehicle.id, command}), isCurrent);
  }
  async function setTimeScale(event: Event) {
    const target = event.target as HTMLSelectElement;
    try {
      applyState(await api("/api/time-scale", { scale: Number(target.value) }));
    } catch (error) {
      toast(errorMessage(error));
      target.value = String(latest.value?.timeScale ?? 1);
    }
  }
  function setMapFocus(value:MapFocus){
    mapFocus.value=value;
    scene?.setMapFocus(value);
  }
  function changeMapFocus(event:Event){setMapFocus((event.target as HTMLSelectElement).value as MapFocus);}
  function setView(value: boolean) {
    globe.value = value;
    scene?.setView(value);
  }
  function setDisplayRate(event: Event) {
    displayRate.value = frameRate((event.target as HTMLSelectElement).value);
    scene?.setFrameRate(displayRate.value);
    renderFps.value = 0;
    try { localStorage.setItem('astroforge-frame-rate', displayRate.value); } catch {}
  }
  function fit(value = false) {
    front.value = value;
    scene?.fit(value);
  }
  function fitSite() {
    scene?.fitSite();
  }
  function zoom(factor: number) {
    scene?.zoom(factor);
  }
  function toggleGrid() {
    grid.value = !grid.value;
    if (scene) scene.grid.visible = grid.value;
  }
  function toggleMarkers() {
    markers.value = !markers.value;
    if (scene) {
      scene.showMarkers = markers.value;
      scene.markers.visible = markers.value;
    }
    if (markers.value) toast("オレンジ：重心 / グリーン：空力中心の概算");
  }
  function openLibrary() {
    if (vehicleMenu.value) vehicleMenu.value.open = false;
    craftDialog.value?.showModal();
  }
  async function copyPartId(id: string) {
    try { await navigator.clipboard.writeText(id); toast('パーツIDをコピーしました'); }
    catch { toast('コピーできませんでした。表示されたIDを選択してコピーしてください'); }
  }
  watch(partInfoSettings, value => {
    try { localStorage.setItem('astroforge-part-info', JSON.stringify(value)); } catch {}
  }, {deep:true});
  function keydown(event: KeyboardEvent) {
    if (loading.value.active) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (
      event.key.toLowerCase() === "m" && flying.value &&
      !event.repeat && !event.isComposing &&
      !event.ctrlKey && !event.metaKey && !event.altKey &&
      !target.closest("input,textarea,select,[contenteditable]:not([contenteditable='false'])") &&
      !document.querySelector("dialog[open]")
    ) {
      event.preventDefault();
      setView(!globe.value);
      return;
    }
    if (
      event.code === "Tab" &&
      flying.value &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !target.matches("input,select,button,a,summary") &&
      !document.querySelector("dialog[open]")
    ) {
      const available = vehicles.value.filter((v) => v.status !== "destroyed");
      if (available.length > 1) {
        event.preventDefault();
        focusVehicle(
          available[
            (available.findIndex((v) => v.id === focusId.value) + 1) %
              available.length
          ].id,
        );
      }
    }
    if (
      target.matches("input,textarea,select") ||
      document.querySelector("dialog[open]") ||
      (flying.value && event.key !== "Escape")
    )
      return;
    if ((event.metaKey || event.ctrlKey) && event.key === "z") {
      event.preventDefault();
      undo();
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      removeSelected();
    }
    if (event.key === "Escape") {
      selectPart(null);
      cancelPlacement();
    }
  }
  watch(
    flying,
    (value) => document.body.classList.toggle("flight-mode", value),
    { immediate: true },
  );
  onMounted(async () => {
    try { partInfoSettings.value = restorePartInfoSettings(JSON.parse(localStorage.getItem('astroforge-part-info') ?? 'null')); } catch {}
    try { displayRate.value = frameRate(localStorage.getItem('astroforge-frame-rate')); } catch {}
    reportLoading("models",1);
    reportLoading("scene",0);
    await afterPaint();
    if (disposed) return;
    try {
      scene = new RocketScene(
        sceneElement.value!,
        selectPart,
        placePart,
        (where, draft) => {
          placement.value = where;
          preview.value = draft ?? null;
        },
        reportLoading,
        true,
      );
      reportLoading("scene",1);
      scene.setFrameRate(displayRate.value);
      const decoder = new StateStreamDecoder();
      stream = new EventSource("/api/events?compact=1");
      stream.addEventListener('configuration', event => {
        decoder.configuration = JSON.parse((event as MessageEvent).data);
      });
      stream.onopen = () => (connected.value = true);
      stream.onerror = () => (connected.value = false);
      reportLoading('state',0);
      let resolveState:()=>void=()=>{};
      const stateReady = new Promise<void>(resolve => { resolveState=resolve; });
      stream.onmessage = (event) => {
        try {
          applyState(decoder.decode(JSON.parse(event.data) as StreamFrame));
          reportLoading("state",1);
          resolveState();
        } catch (error) {
          console.error(error);
        }
      };
      fpsTimer = setInterval(() => {
        renderFps.value = scene?.fps ?? 0;
        mapPredictionStatus.value=scene?.solarMap.predictionStatus??"";
      }, 1000);
      document.addEventListener("keydown", keydown);
      let timeout:ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          (async () => {
            await Promise.all([scene!.ready, stateReady]);
            if (disposed) return;
            await scene!.prepare(reportLoading);
            if (!disposed && !loading.value.error) loading.value.active=false;
          })(),
          new Promise<never>((_,reject) => { timeout=setTimeout(() => reject(new Error('読み込みがタイムアウトしました。サーバー接続と3Dデータを確認してください。')),120000); }),
        ]);
      } finally { clearTimeout(timeout); }
    } catch (error) {
      if (disposed) return;
      sceneError.value=true;
      loading.value.error=errorMessage(error);
      scene?.dispose();
      scene=undefined;
      console.error(error);
    }
  });
  onUnmounted(() => {
    disposed=true;
    stream?.close();
    clearInterval(fpsTimer);
    clearTimeout(toastTimer);
    document.removeEventListener("keydown", keydown);
    scene?.dispose();
    document.body.classList.remove("flight-mode");
  });
  return {
    loading, reload,
    partInfoSettings, copyPartId, sendPartCommand,
    displayRate,
    renderFps,
    frameRates,
    setDisplayRate,
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
    globe, mapFocus, changeMapFocus, mapPredictionStatus,
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
    LAUNCH_SITES, launchDialog, launchCraft, launchSite, launchPreview, launchBusy, launchChecking, recoverOccupants, launchError, canLaunch, refreshLaunchPreview, confirmLaunch,
    backToFlight,
    save,
    undo,
    reset,
    focusVehicle,
    toggleUdp,
    setTimeScale,
    setView,
    fit,
    fitSite,
    zoom,
    toggleGrid,
    toggleMarkers,
    openLibrary,
    movingIds,
  };
}
