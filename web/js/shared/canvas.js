(function () {
  const { ref, computed } = Vue;

  window.useCanvas = function (apiGet, callbacks) {
    const { onKpCardRender } = callbacks || {};

    const canvasRef = ref(null);
    const scale = ref(0.8);
    const translateX = ref(200);
    const translateY = ref(-700);
    const nodes = ref([]);
    const edges = ref([]);
    const kpMasteryMap = ref({});
    const rootPos = ref({ x: 200, y: 1000 });
    const activeCard = ref(null);

    const canvasTransformStyle = computed(() => ({
      transform: `translate(${translateX.value}px, ${translateY.value}px) scale(${scale.value})`,
      transformOrigin: '0 0',
    }));

    // ── Drill-down tree navigation ──
    const focusPath = ref([]);

    function pushFocus(nodeId, nodeLabel) {
      focusPath.value = [...focusPath.value, { id: nodeId, label: nodeLabel }];
    }
    function popFocus() {
      focusPath.value = focusPath.value.slice(0, -1);
    }
    function clearFocus() {
      focusPath.value = [];
    }

    // ── Virtual root node ──
    function addRootNode() {
      nodes.value = nodes.value.filter(n => n.id !== 'root');
      edges.value = edges.value.filter(e => e.fromId !== 'root' && e.toId !== 'root');
      nodes.value.unshift({ id: 'root', type: 'root', label: '知识库' });
      const subs = nodes.value.filter(n => n.type === 'subject');
      for (const s of subs) {
        edges.value.push({ id: 'e-root-' + s.id, fromId: 'root', toId: s.id, label: '' });
      }
    }

    // ── KP Card management ──
    function showKpCard(kpId, label) {
      hideKpCard();
      const kpNode = nodes.value.find(n => n.id === 'kp-' + kpId);
      if (!kpNode) return;
      const cardId = 'card-' + kpId;
      const masterData = kpMasteryMap.value[kpId] || {};
      activeCard.value = { kpId, cardId };
      const mastery = masterData.mastery || 0;
      const cardW = mastery > 0 ? 260 : 200;
      const cardH = mastery > 0 ? 150 : 110;
      const kpW = getNodeWidth(kpNode);
      const kpH = getNodeHeight(kpNode);
      nodes.value = [...nodes.value, {
        id: cardId, type: 'card', label,
        kpId, mastery,
        questionCount: masterData.question_count || 0,
        x: kpNode.x + kpW + 30,
        y: kpNode.y + (kpH - cardH) / 2,
        w: cardW, h: cardH,
      }];
      edges.value = [...edges.value, { id: 'e-' + cardId, fromId: kpNode.id, toId: cardId, label: '' }];
    }

    function hideKpCard() {
      if (activeCard.value) {
        const cid = activeCard.value.cardId;
        nodes.value = nodes.value.filter(n => n.id !== cid);
        edges.value = edges.value.filter(
          e => e.toId !== cid && e.fromId !== cid
        );
        activeCard.value = null;
      }
    }

    function toggleKpCard(kpId, label) {
      if (activeCard.value && activeCard.value.kpId === kpId) {
        hideKpCard();
      } else {
        showKpCard(kpId, label);
      }
    }

    // ── visibleNodes: drill-down filter, always include root + card ──
    const visibleNodes = computed(() => {
      const focus = focusPath.value;
      const allNodes = nodes.value;
      const allEdges = edges.value;

      const visibleIds = new Set();
      visibleIds.add('root');

      // Card visible if active, keep its KP visible too
      if (activeCard.value) {
        visibleIds.add(activeCard.value.cardId);
        const cardEdge = allEdges.find(e => e.toId === activeCard.value.cardId);
        if (cardEdge) visibleIds.add(cardEdge.fromId);
      }

      if (focus.length === 0) {
        for (const n of allNodes) {
          if (n.type === 'subject') visibleIds.add(n.id);
        }
      } else {
        for (const f of focus) visibleIds.add(f.id);
        const lastId = focus[focus.length - 1].id;
        for (const e of allEdges) {
          if (e.fromId === lastId) visibleIds.add(e.toId);
        }
      }

      return allNodes.filter(n => visibleIds.has(n.id));
    });

    const visibleEdges = computed(() => {
      const vIds = new Set(visibleNodes.value.map(n => n.id));
      return edges.value.filter(e => vIds.has(e.fromId) && vIds.has(e.toId));
    });

    const edgesWithLabels = computed(() => visibleEdges.value.filter(e => e.label));

    // ── Node helpers ──
    function getNodeWidth(node) {
      if (node.w) return node.w;
      return node.type === 'subject' || node.type === 'root' ? 140 : 120;
    }
    function getNodeHeight(node) {
      if (node.h) return node.h;
      return node.type === 'subject' || node.type === 'root' ? 52 : 38;
    }

    function getNodeCenter(node) {
      return { x: node.x + getNodeWidth(node) / 2, y: node.y + getNodeHeight(node) / 2 };
    }

    // Edge: right-middle of parent → left-middle of child
    function getEdgePath(edge) {
      const from = nodes.value.find(n => n.id === edge.fromId);
      const to = nodes.value.find(n => n.id === edge.toId);
      if (!from || !to) return '';
      const fw = getNodeWidth(from), fh = getNodeHeight(from);
      const th = getNodeHeight(to);
      const startX = from.x + fw;
      const startY = from.y + fh / 2;
      const endX = to.x;
      const endY = to.y + th / 2;
      const dx = Math.abs(startX - endX) * 0.4;
      return `M ${startX} ${startY} C ${startX + dx} ${startY}, ${endX - dx} ${endY}, ${endX} ${endY}`;
    }

    function getEdgeLabelPos(edge) {
      const from = nodes.value.find(n => n.id === edge.fromId);
      const to = nodes.value.find(n => n.id === edge.toId);
      if (!from || !to) return { x: 0, y: 0 };
      const fromC = getNodeCenter(from);
      const toC = getNodeCenter(to);
      return { x: (fromC.x + toC.x) / 2, y: (fromC.y + toC.y) / 2 - 8 };
    }

    function nodeStyle(node) {
      const w = getNodeWidth(node);
      const h = getNodeHeight(node);
      let borderColor = '';
      if (node.type === 'knowledge_point') {
        const kpId = node.id.startsWith('kp-') ? parseInt(node.id.slice(3)) : null;
        const m = kpId ? kpMasteryMap.value[kpId] : null;
        if (m) {
          if (m.mastery < 0.5) borderColor = '#e05555';
          else if (m.mastery <= 0.8) borderColor = '#e0c055';
          else borderColor = '#5a9a5a';
        }
      }
      const style = { left: node.x + 'px', top: node.y + 'px', width: w + 'px' };
      if (h) style.height = h + 'px';
      if (borderColor) style.borderColor = borderColor;
      return style;
    }

    // ── Canvas interaction ──
    let isPanning = false, panStart = { x: 0, y: 0 }, tsStart = { x: 0, y: 0 };

    function handleCanvasMouseDown(e) {
      if (e.target.closest('.graph-node')) return;
      isPanning = true;
      panStart = { x: e.clientX, y: e.clientY };
      tsStart = { x: translateX.value, y: translateY.value };
      window.addEventListener('mousemove', onPanMove);
      window.addEventListener('mouseup', onPanUp);
    }

    function onPanMove(e) {
      if (!isPanning) return;
      translateX.value = tsStart.x + e.clientX - panStart.x;
      translateY.value = tsStart.y + e.clientY - panStart.y;
    }

    function onPanUp() {
      isPanning = false;
      window.removeEventListener('mousemove', onPanMove);
      window.removeEventListener('mouseup', onPanUp);
    }

    function handleWheel(e) {
      const delta = -e.deltaY * 0.001;
      const newScale = Math.min(3, Math.max(0.2, scale.value * (1 + delta)));
      const rect = canvasRef.value.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const cx = (mx - translateX.value) / scale.value;
      const cy = (my - translateY.value) / scale.value;
      scale.value = newScale;
      translateX.value = mx - cx * scale.value;
      translateY.value = my - cy * scale.value;
    }

    function hasChildren(nodeId) {
      return edges.value.some(e => e.fromId === nodeId && !e.toId.startsWith('card-'));
    }

    // ── Node click: NEVER calls relayout (positions are fixed) ──
    function onNodeClick(node) {
      if (node.id === 'root') {
        clearFocus();
        hideKpCard();
      } else if (node.type === 'subject') {
        hideKpCard();
        const idx = focusPath.value.findIndex(f => f.id === node.id);
        if (idx >= 0) {
          focusPath.value = focusPath.value.slice(0, idx + 1);
        } else {
          pushFocus(node.id, node.label);
        }
      } else if (node.type === 'knowledge_point') {
        if (hasChildren(node.id)) {
          hideKpCard();
          const idx = focusPath.value.findIndex(f => f.id === node.id);
          if (idx >= 0) {
            focusPath.value = focusPath.value.slice(0, idx + 1);
          } else {
            pushFocus(node.id, node.label);
          }
        } else {
          const kpId = node.id.startsWith('kp-') ? parseInt(node.id.slice(3)) : null;
          if (kpId) toggleKpCard(kpId, node.label);
        }
      }
    }

    // ── Pre-compute fixed tree layout (called once on graph load) ──
    function computeTreeLayout() {
      const centerX = 200, centerY = 1000;
      const levelGap = 220, subjGap = 40, kpGap = 42;

      const rootNode = nodes.value.find(n => n.id === 'root');
      rootNode.x = centerX;
      rootNode.y = centerY;
      rootPos.value = { x: centerX, y: centerY };

      // Build children map (exclude card edges)
      const childrenMap = {};
      for (const e of edges.value) {
        if (e.toId.startsWith('card-')) continue;
        if (!childrenMap[e.fromId]) childrenMap[e.fromId] = [];
        childrenMap[e.fromId].push(e.toId);
      }

      // Layer 1: subjects evenly spaced vertically
      const subs = nodes.value.filter(n => n.type === 'subject');
      subs.forEach((s, i) => {
        s.x = centerX + levelGap;
        s.y = centerY + i * (52 + subjGap);
      });

      // Recursively position children to the RIGHT of parent, centered vertically
      function layoutChildren(parentId, parentX) {
        const kids = childrenMap[parentId] || [];
        if (!kids.length) return;
        const parent = nodes.value.find(n => n.id === parentId);
        if (!parent) return;
        const kidX = parentX + levelGap;
        const h = 38;
        const kidStartY = parent.y - (kids.length - 1) * (h + kpGap) / 2;
        kids.forEach((kidId, i) => {
          const kid = nodes.value.find(n => n.id === kidId);
          if (!kid) return;
          kid.x = kidX;
          kid.y = kidStartY + i * (h + kpGap);
          layoutChildren(kidId, kidX);
        });
      }

      for (const s of subs) {
        layoutChildren(s.id, s.x);
      }
    }

    // ── autoLayout: add root + compute fixed positions ──
    function autoLayout() {
      addRootNode();
      computeTreeLayout();
    }

    // relayout is a no-op for positions; only used to re-clamp visible nodes
    // after external changes (e.g. quiz exit). Positions never change.
    function relayout() {
      // nothing — positions are fixed from computeTreeLayout
    }

    // ── Data fetching ──
    async function fetchGraph() {
      try {
        const data = await apiGet('/api/graph');
        nodes.value = data.nodes || [];
        edges.value = data.edges || [];
        autoLayout();
      } catch (e) {
        console.error('fetchGraph', e);
      }
    }

    async function fetchMastery() {
      try {
        const data = await apiGet('/api/user/kp-mastery');
        const map = {};
        for (const m of data || []) {
          map[m.kp_id] = m;
        }
        kpMasteryMap.value = map;
      } catch (e) { console.error('fetchMastery', e); }
    }

    return {
      canvasRef, scale, translateX, translateY, nodes, edges,
      kpMasteryMap, rootPos,
      visibleNodes, visibleEdges, edgesWithLabels,
      canvasTransformStyle,
      getEdgePath, getEdgeLabelPos, nodeStyle,
      handleCanvasMouseDown, handleWheel, onNodeClick,
      relayout, autoLayout, fetchGraph, fetchMastery,
      focusPath, pushFocus, popFocus, clearFocus,
      hasChildren,
      activeCard, showKpCard, hideKpCard, toggleKpCard,
      getNodeWidth, getNodeHeight,
      isPanning: () => isPanning,
    };
  };
})();
