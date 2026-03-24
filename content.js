// YouTube Transcript Copy — Content Script
// Clicks "Show transcript", reads DOM, copies to clipboard

function makeSvg(type) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.style.verticalAlign = "-2px";

  if (type === "copy") {
    const rect = document.createElementNS(ns, "rect");
    rect.setAttribute("x", "9"); rect.setAttribute("y", "9");
    rect.setAttribute("width", "13"); rect.setAttribute("height", "13");
    rect.setAttribute("rx", "2"); rect.setAttribute("ry", "2");
    svg.appendChild(rect);
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1");
    svg.appendChild(path);
  } else {
    const poly = document.createElementNS(ns, "polyline");
    poly.setAttribute("points", "20 6 9 17 4 12");
    svg.appendChild(poly);
  }
  return svg;
}

function setBtnContent(btn, icon, text) {
  while (btn.firstChild) btn.removeChild(btn.firstChild);
  btn.appendChild(makeSvg(icon));
  btn.appendChild(document.createTextNode(" " + text));
}

function getVideoId() {
  return new URL(window.location.href).searchParams.get("v");
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ============================================================
// Transcript 추출
// ============================================================

// 영상별 transcript 캐시
const transcriptCache = {};

async function getTranscript() {
  const videoId = getVideoId();
  if (!videoId) throw new Error("영상 ID를 찾을 수 없습니다");

  // 캐시에 현재 영상 transcript가 있으면 바로 반환
  if (transcriptCache[videoId]) {
    return transcriptCache[videoId];
  }

  // 1. 자막 패널 완전 리셋: 패널 닫기
  closeTranscriptPanel();
  await sleep(800);

  // 2. "더보기" 클릭
  const moreBtn = document.querySelector("tp-yt-paper-button#expand");
  if (moreBtn) {
    moreBtn.click();
    await sleep(800);
  }

  // 3. "스크립트 표시" 클릭
  const showBtn = findTranscriptButton();
  if (!showBtn) {
    throw new Error("'스크립트 표시' 버튼을 찾을 수 없습니다.");
  }
  showBtn.click();

  // 4. 새 자막 로딩 대기 (최대 15초)
  let segments;
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    segments = document.querySelectorAll("transcript-segment-view-model");
    if (segments.length > 0) break;
  }

  if (!segments || segments.length === 0) {
    throw new Error("자막이 로드되지 않았습니다.");
  }

  const text = extractFromDOM(segments);

  // 캐시 저장
  transcriptCache[videoId] = text;

  return text;
}

function closeTranscriptPanel() {
  // 방법 1: engagement panel의 닫기 버튼
  document.querySelectorAll('ytd-engagement-panel-section-list-renderer').forEach(panel => {
    const vis = panel.getAttribute('visibility');
    if (vis === 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED') {
      const title = (panel.querySelector('#title-text')?.textContent || '').toLowerCase();
      if (title.includes('transcript') || title.includes('스크립트')) {
        // visibility 속성 변경으로 닫기
        panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN');
        // 닫기 버튼도 클릭
        const btns = panel.querySelectorAll('button');
        btns.forEach(b => {
          const label = (b.getAttribute('aria-label') || '').toLowerCase();
          if (label.includes('close') || label.includes('닫기')) b.click();
        });
      }
    }
  });

  // 방법 2: 세그먼트 DOM 직접 제거 (확실한 초기화)
  document.querySelectorAll("transcript-segment-view-model").forEach(el => el.remove());
}

function findTranscriptButton() {
  // "스크립트 표시" / "Show transcript" 텍스트로 찾기
  const allButtons = document.querySelectorAll(
    "ytd-video-description-transcript-section-renderer button, " +
    "button.yt-spec-button-shape-next"
  );

  for (const btn of allButtons) {
    const text = btn.textContent.trim().toLowerCase();
    if (text.includes("스크립트") || text.includes("transcript") || text.includes("자막")) {
      return btn;
    }
  }

  // aria-label로 찾기
  const ariaBtn = document.querySelector(
    'button[aria-label*="transcript" i], button[aria-label*="스크립트" i]'
  );
  if (ariaBtn) return ariaBtn;

  // description section 내 버튼
  const descSection = document.querySelector("ytd-video-description-transcript-section-renderer");
  if (descSection) {
    const btn = descSection.querySelector("button");
    if (btn) return btn;
  }

  return null;
}

function extractFromDOM(segments) {
  const lines = [];
  for (const seg of segments) {
    const ts = seg.querySelector(".ytwTranscriptSegmentViewModelTimestamp")
      ?.textContent?.trim() || "";
    const text = seg.querySelector("span.yt-core-attributed-string")
      ?.textContent?.trim() || "";
    if (text) {
      lines.push(ts ? "[" + ts + "] " + text : text);
    }
  }
  return lines.join("\n");
}

// ============================================================
// 클립보드 복사
// ============================================================

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;left:-9999px;top:-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}

// ============================================================
// 버튼 삽입
// ============================================================

let lastVideoId = null;

function insertButton() {
  const videoId = getVideoId();
  if (!videoId) return;

  // 영상 변경 시 기존 버튼 제거 + 캐시 유지 (캐시는 videoId별)
  if (videoId !== lastVideoId) {
    document.getElementById("yt-copy-trigger")?.remove();
    lastVideoId = videoId;
  }

  if (document.getElementById("yt-copy-trigger")) return;

  const flexBar = document.querySelector("#flexible-item-buttons");
  const topBar = document.querySelector("#top-level-buttons-computed");
  const actionsBar =
    (flexBar && flexBar.children.length > 0) ? flexBar :
    (topBar && topBar.children.length > 0) ? topBar :
    null;

  if (!actionsBar) return;

  const btn = document.createElement("button");
  btn.id = "yt-copy-trigger";
  btn.className = "yt-summary-btn";
  setBtnContent(btn, "copy", "Copy");

  btn.onclick = async () => {
    const vid = getVideoId();
    if (!vid) return;

    btn.classList.add("loading");
    btn.textContent = "Copying...";
    btn.disabled = true;

    try {
      const text = await getTranscript();
      if (text && text.length > 10) {
        await copyToClipboard(text);
        setBtnContent(btn, "check", "Copied!");
        console.log("[YT-Copy] 복사 완료: " + text.split("\n").length + "줄");
        setTimeout(function() { setBtnContent(btn, "copy", "Copy"); }, 2000);
      } else {
        throw new Error("자막이 비어있습니다");
      }
    } catch (err) {
      console.error("[YT-Copy] 실패:", err.message);
      setBtnContent(btn, "copy", "Copy");
      btn.title = err.message;
      setTimeout(function() { btn.title = ""; }, 4000);
    } finally {
      btn.classList.remove("loading");
      btn.disabled = false;
    }
  };

  actionsBar.appendChild(btn);
}

// ============================================================
// 영상 변경 감지 + 버튼 지속 삽입
// ============================================================

// 영상 변경 시 캐시 없는 videoId면 패널 초기화
let trackedVideoId = null;
function onVideoChange() {
  const vid = getVideoId();
  if (vid && vid !== trackedVideoId) {
    trackedVideoId = vid;
    // 이전 자막 패널 닫기
    closeTranscriptPanel();
  }
}

// URL 변경 + 버튼 존재 확인을 500ms마다
let prevUrl = "";
setInterval(function() {
  const url = location.href;
  if (url !== prevUrl) {
    prevUrl = url;
    lastVideoId = null;
    onVideoChange();
  }
  if (location.pathname === "/watch" && !document.getElementById("yt-copy-trigger")) {
    insertButton();
  }
}, 500);

// 초기 로드
insertButton();
onVideoChange();
