define(["sugar-web/activity/activity", "sugar-web/env", "sugar-web/graphics/presencepalette", "sugar-web/datastore", "humane", "l10n"], function (activity, env, presencepalette, datastore, humane, l10n) {
    'use strict';

    requirejs(['domReady!'], function (doc) {

        const canvas = document.getElementById('main-canvas');
        const ctx = canvas.getContext('2d');

        const GRID_SPACING = 50;
        const SNAP_RADIUS = 22;
        const DOT_RADIUS = 10;
        let currentColor = '#ffffff';

        let currentMode = 'draw'; // 'draw', 'number', 'game'
        let currentTemplateIndex = 0;

        // Hardcoded default template example: A star
        const defaultTemplates = [
            {
                points: [
                    { x: 250, y: 100 }, { x: 300, y: 200 }, { x: 400, y: 200 },
                    { x: 325, y: 250 }, { x: 350, y: 350 }, { x: 250, y: 300 },
                    { x: 150, y: 350 }, { x: 175, y: 250 }, { x: 100, y: 200 },
                    { x: 200, y: 200 }, { x: 250, y: 100 } // Closed shape
                ]
            },
            {
                points: [
                    { x: 150, y: 300 }, { x: 150, y: 150 }, { x: 250, y: 50 },
                    { x: 350, y: 150 }, { x: 350, y: 300 }, { x: 150, y: 300 } // House shape
                ]
            },
            {
                points: [
                    { x: 150, y: 150 }, { x: 350, y: 150 }, { x: 350, y: 350 },
                    { x: 150, y: 350 }, { x: 150, y: 150 } // Square shape
                ]
            },
            {
                points: [
                    { x: 250, y: 100 }, { x: 350, y: 250 }, { x: 250, y: 400 },
                    { x: 150, y: 250 }, { x: 250, y: 100 } // Diamond shape
                ]
            },
            {
                points: [
                    { x: 250, y: 100 }, { x: 350, y: 150 }, { x: 350, y: 300 },
                    { x: 250, y: 350 }, { x: 150, y: 300 }, { x: 150, y: 150 }, { x: 250, y: 100 } // Hexagon shape
                ]
            }
        ];

        const state = {
            mode: 'draw',
            dots: [],   // {x, y}
            lines: [],   // {x1,y1, x2,y2, color, inPolygon}
            fills: [],   // {points:[{x,y}], color, area}
            chainDots: [],   // ordered dots in the current open chain
            dragFrom: null, // dot user is dragging from
            dragPos: null, // live cursor during drag
            hoverPos: null, // live cursor pos when not dragging

            // Template properties
            templates: defaultTemplates,
            templatePoints: [], // The active sequence of points for the current template
            connectedTargetIndex: 0, // In number mode, which dot sequence index is the user supposed to connect NEXT

            loadedImages: {} // Cache for template images
        };

        const undoStack = [];

        function saveSnapshot() {
            const currentState = JSON.stringify({
                dots: state.dots,
                lines: state.lines,
                fills: state.fills,
                chainDots: state.chainDots,
                connectedTargetIndex: state.connectedTargetIndex,
                won: copyState.won
            });
            if (undoStack.length === 0 || undoStack[undoStack.length - 1] !== currentState) {
                undoStack.push(currentState);
            }
        }

        const gameState = {
            active: false,
            aiInterval: null,
            aiActive: true,
            lastMoveTime: {}, // map networkId -> last time
            players: {}, // map networkId -> { color, territory, trail, alive, isAI }
            playerOrder: [] // join-order list for stable corner assignment
        };
        let myNetworkId = 'local';
        let aiButton = document.getElementById('ai-toggle-button');

        // ─── Copy Mode State ──────────────────────────────────────────────────────
        const copyState = {
            active: false,
            targetPoints: [],   // The template points (scaled to right half)
            targetLines: [],    // Lines connecting the template points
            targetColor: '#ff8c00',
            templateName: '',
            dividerX: 0,        // x coordinate of the center divider
            won: false           // track if user already achieved 100%
        };

        const COPY_COLORS = [
            '#1a6ef5', '#f51a1a', '#1af53b', '#f5d41a',
            '#9c1af5', '#1af5e3', '#f51a9c', '#ff8c00'
        ];

        // ─── Canvas resize ────────────────────────────────────────────────────────
        function resizeCanvas() {
            const toolbar = document.getElementById('main-toolbar');
            const toolbarH = toolbar ? toolbar.offsetHeight : 55;
            const dpr = window.devicePixelRatio || 1;
            const cssW = window.innerWidth;
            const cssH = window.innerHeight - toolbarH;

            canvas.width = cssW * dpr;
            canvas.height = cssH * dpr;
            canvas.style.width = cssW + 'px';
            canvas.style.height = cssH + 'px';
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            render();
        }
        window.addEventListener('resize', resizeCanvas);

        // ─── Helpers ──────────────────────────────────────────────────────────────
        function getPos(e) {
            const rect = canvas.getBoundingClientRect();
            const src = (e.touches && e.touches.length) ? e.touches[0]
                : (e.changedTouches && e.changedTouches.length) ? e.changedTouches[0]
                    : e;
            return { x: src.clientX - rect.left, y: src.clientY - rect.top };
        }

        function snapToGrid(x, y) {
            return {
                x: Math.round(x / GRID_SPACING) * GRID_SPACING,
                y: Math.round(y / GRID_SPACING) * GRID_SPACING,
            };
        }

        function findNearDot(x, y) {
            return state.dots.find(d => Math.hypot(d.x - x, d.y - y) < SNAP_RADIUS) || null;
        }

        // ─── Game Mode movement helper ──────────────────────────────────────────────
        function moveUserGame(dx, dy) {
            const myPlayer = gameState.players[myNetworkId];
            if (!gameState.active || !myPlayer || !myPlayer.alive) return;

            const now = Date.now();
            if (now - (gameState.lastMoveTime[myNetworkId] || 0) < 450) return; // Throttled

            // Auto-init dragFrom if not set (e.g. arrow keys pressed before any mouse click)
            if (!state.dragFrom) {
                const trail = myPlayer.trail;
                if (trail.length > 0) {
                    state.dragFrom = { x: trail[trail.length - 1].x, y: trail[trail.length - 1].y };
                } else if (myPlayer.territory.length > 0) {
                    const t = myPlayer.territory[0];
                    state.dragFrom = { x: t.x, y: t.y };
                } else {
                    return; // Nothing to move from
                }
            }

            let nextX = state.dragFrom.x + Math.sign(dx) * GRID_SPACING;
            let nextY = state.dragFrom.y + Math.sign(dy) * GRID_SPACING;

            const trail = myPlayer.trail;
            const lastTrail = trail.length > 1 ? trail[trail.length - 2] : null;
            if (lastTrail && lastTrail.x === nextX && lastTrail.y === nextY) return; // No reversing

            const dpr = window.devicePixelRatio || 1;
            if (nextX <= 0 || nextX > canvas.width / dpr || nextY <= 0 || nextY > canvas.height / dpr) return;

            gameState.lastMoveTime[myNetworkId] = now;

            if (trail.length === 0) trail.push({ x: state.dragFrom.x, y: state.dragFrom.y });

            trail.push({ x: nextX, y: nextY });
            state.dragFrom = { x: nextX, y: nextY };

            if (myPlayer.territory.find(t => t.x === nextX && t.y === nextY)) {
                captureGameTerritory(myNetworkId);
                myPlayer.trail = [];
            }

            // Kill check: Did we collide with ANY opponent's trail?
            for (const [id, opp] of Object.entries(gameState.players)) {
                if (id === myNetworkId) continue;
                if (opp.trail.find(t => t.x === nextX && t.y === nextY)) {
                    eliminatePlayer(id);
                }
            }

            render();
            if (typeof broadcastStateUpdate === 'function') broadcastStateUpdate();
        }

        // ─── Input ────────────────────────────────────────────────────────────────
        function onStart(e) {
            e.preventDefault();
            const raw = getPos(e);
            let hit = findNearDot(raw.x, raw.y);

            if (state.mode === 'number') {
                // In number mode, you MUST start dragging from the current active target dot
                const requiredStartDot = state.templatePoints[state.connectedTargetIndex];
                if (!requiredStartDot || !hit || hit.x !== requiredStartDot.x || hit.y !== requiredStartDot.y) {
                    return; // Ignore clicks anywhere else
                }
            } else if (state.mode === 'game') {
                const myPlayer = gameState.players[myNetworkId];
                if (!gameState.active || !myPlayer || !myPlayer.alive) return;

                const trail = myPlayer.trail;

                // If user is mid-trail, re-attaching drag to the trail head so movement continues smoothly
                if (trail.length > 0) {
                    hit = trail[trail.length - 1];
                } else {
                    const s = snapToGrid(raw.x, raw.y);
                    // Must start drag on a dot that we own
                    const ownTerritory = myPlayer.territory.find(t => t.x === s.x && t.y === s.y);
                    if (!ownTerritory) return;
                    hit = ownTerritory;
                    trail.push({ x: hit.x, y: hit.y });
                }
            } else if (state.mode === 'copy') {
                // Copy mode: restrict to left half
                if (raw.x > copyState.dividerX) return;
                if (!hit) {
                    const s = snapToGrid(raw.x, raw.y);
                    if (s.x >= copyState.dividerX) return;
                    hit = state.dots.find(d => d.x === s.x && d.y === s.y);
                    if (!hit) {
                        hit = { x: s.x, y: s.y };
                        state.dots.push(hit);
                    }
                }
            } else {
                // Draw mode logic
                if (!hit) {
                    // Click on empty grid -> place a new standalone dot
                    const s = snapToGrid(raw.x, raw.y);
                    hit = state.dots.find(d => d.x === s.x && d.y === s.y);
                    if (!hit) {
                        hit = { x: s.x, y: s.y };
                        state.dots.push(hit);
                    }
                }
            }

            // Call saveSnapshot right before we start changing state with a new chain/drag
            saveSnapshot();

            // Start a continuous drag FROM this dot immediately
            state.dragFrom = hit;
            state.dragPos = raw;
            state.chainDots = [hit];   // fresh chain each mousedown

            render();
            
            // Sync my drag state immediately
            if (gameState.players[myNetworkId]) {
                gameState.players[myNetworkId].dragFrom = state.dragFrom;
                gameState.players[myNetworkId].dragPos = state.dragPos;
                gameState.players[myNetworkId].color = currentColor;
            }

            if (typeof broadcastStateUpdate === 'function') broadcastStateUpdate(true);
        }

        function onMove(e) {
            // e.preventDefault(); (Don't prevent scrolling generally if not dragging)
            const raw = getPos(e);

            if (!state.dragFrom) {
                state.hoverPos = raw;
                render();
                return;
            }

            e.preventDefault();
            state.hoverPos = null;
            state.dragPos = raw;

            if (state.mode === 'game') {
                const myPlayer = gameState.players[myNetworkId];
                if (!gameState.active || !myPlayer || !myPlayer.alive) return;

                let dx = raw.x - state.dragFrom.x;
                let dy = raw.y - state.dragFrom.y;

                if (Math.abs(dx) < GRID_SPACING / 2 && Math.abs(dy) < GRID_SPACING / 2) return;

                // Pick the dominant axis
                if (Math.abs(dx) > Math.abs(dy)) {
                    moveUserGame(dx, 0);
                    state.dragFrom = { x: state.dragFrom.x + Math.sign(dx) * GRID_SPACING, y: state.dragFrom.y };
                } else {
                    moveUserGame(0, dy);
                    state.dragFrom = { x: state.dragFrom.x, y: state.dragFrom.y + Math.sign(dy) * GRID_SPACING };
                }
                return;
            }

            // --- Auto-connect every dot the cursor sweeps near ---
            let target = findNearDot(raw.x, raw.y);

            if (state.mode === 'number') {
                // In number mode, the target MUST be exactly the next dot in the sequence
                const requiredEndDot = state.templatePoints[state.connectedTargetIndex + 1];

                // If dragging over nothing or the wrong dot, do not connect
                if (!requiredEndDot || !target || target.x !== requiredEndDot.x || target.y !== requiredEndDot.y) {
                    target = null;
                }
            } else if (state.mode === 'game') {
                // Game mode logic
                if (!target) {
                    const s = snapToGrid(raw.x, raw.y);
                    if (Math.hypot(s.x - raw.x, s.y - raw.y) < SNAP_RADIUS) {
                        target = { x: s.x, y: s.y };
                    }
                }
            } else if (state.mode === 'copy') {
                // Copy mode: restrict to left half
                if (raw.x > copyState.dividerX) return;
                if (!target) {
                    const s = snapToGrid(raw.x, raw.y);
                    if (s.x < copyState.dividerX && Math.hypot(s.x - raw.x, s.y - raw.y) < SNAP_RADIUS) {
                        target = { x: s.x, y: s.y };
                    }
                }
            } else {
                // Draw mode logic
                // If an empty grid spot is swept near, make it a target dot
                if (!target) {
                    const s = snapToGrid(raw.x, raw.y);
                    if (Math.hypot(s.x - raw.x, s.y - raw.y) < SNAP_RADIUS) {
                        target = { x: s.x, y: s.y };
                    }
                }
            }

            // Helper: Find simplest cycle in an undirected graph from a newly added edge
            function findCycle(startDot, endDot, color) {
                // Build adjacency list for lines of this color that are NOT already in a polygon
                const adj = new Map();
                state.lines.forEach(l => {
                    if (l.color !== color || l.inPolygon) return;
                    const p1 = `${l.x1},${l.y1}`;
                    const p2 = `${l.x2},${l.y2}`;
                    if (!adj.has(p1)) adj.set(p1, []);
                    if (!adj.has(p2)) adj.set(p2, []);
                    adj.get(p1).push(p2);
                    adj.get(p2).push(p1);
                });

                // BFS from startDot trying to reach endDot without using the direct edge
                const startKey = `${startDot.x},${startDot.y}`;
                const endKey = `${endDot.x},${endDot.y}`;

                if (!adj.has(startKey) || !adj.has(endKey)) return null;

                const queue = [[startKey]];
                const visited = new Set([startKey]);

                while (queue.length > 0) {
                    const path = queue.shift();
                    const curr = path[path.length - 1];

                    const neighbors = adj.get(curr) || [];
                    for (let n of neighbors) {
                        // Skip the direct immediate connection backward
                        if (path.length > 1 && n === path[path.length - 2]) continue;

                        if (n === endKey) {
                            // Found cycle! Must be at least a triangle (path length >= 2 nodes before adding endKey)
                            if (path.length >= 2) {
                                return [...path, n];
                            } else {
                                // Represents the literal edge we just drew (or a duplicate). Ignore it to find macroscopic cycles.
                                continue;
                            }
                        }
                        if (!visited.has(n)) {
                            visited.add(n);
                            queue.push([...path, n]);
                        }
                    }
                }
                return null;
            }

            function gcd(a, b) {
                return b === 0 ? a : gcd(b, a % b);
            }

            if (target && target !== state.dragFrom) {
                const fromDot = state.dragFrom;

                // PERFORMANCE OPTIMIZATION: Broadcast the VERY FIRST segment of any stroke 
                // immediately so the recipient sees the start instantly. 
                // The rest of the stroke will be throttled.
                const isFirstSegment = (state.chainDots.length === 1);
                if (isFirstSegment && typeof broadcastStateUpdate === 'function') {
                    broadcastStateUpdate(true);
                }

                const stepsX = Math.round(Math.abs(target.x - fromDot.x) / GRID_SPACING);
                const stepsY = Math.round(Math.abs(target.y - fromDot.y) / GRID_SPACING);
                let steps = gcd(stepsX, stepsY);

                // In number mode, NEVER interpolate intermediate dots. You are connecting EXACT nodes even if they skip grid spacing.
                if (state.mode === 'number') steps = 1;

                // If steps is 0 (cursor hasn't actually moved grid spacing), ignore
                if (steps > 0) {
                    const stepX = (target.x - fromDot.x) / steps;
                    const stepY = (target.y - fromDot.y) / steps;

                    // Process each step along the line to ensure we connect through them individually
                    let prevDot = state.dragFrom;

                    for (let i = 1; i <= steps; i++) {
                        const nextX = fromDot.x + stepX * i;
                        const nextY = fromDot.y + stepY * i;


                        let stepTarget = findNearDot(nextX, nextY);
                        if (!stepTarget) {
                            stepTarget = { x: nextX, y: nextY };
                            state.dots.push(stepTarget);
                        }

                        const chainLen = state.chainDots.length;

                        // Add the line to our global state
                        const newLine = {
                            x1: prevDot.x, y1: prevDot.y,
                            x2: stepTarget.x, y2: stepTarget.y,
                            color: currentColor,
                            inPolygon: false
                        };
                        state.lines.push(newLine);

                        if (state.mode === 'number') {
                            state.connectedTargetIndex++;

                            // Check if template is fully completed
                            if (state.connectedTargetIndex === state.templatePoints.length - 1) {
                                // Check if the first and last dot are the exact same coordinates (a closed loop shape)
                                const firstDot = state.templatePoints[0];
                                const lastDot = state.templatePoints[state.templatePoints.length - 1];

                                if (firstDot.x === lastDot.x && firstDot.y === lastDot.y) {
                                    // Close the shape!
                                    const pts = [...state.templatePoints];
                                    pts.pop(); // Remove the duplicate closing point

                                    // Mark lines as inPolygon
                                    state.lines.forEach(l => l.inPolygon = true);

                                    state.fills.push({
                                        points: pts,
                                        color: currentColor,
                                        area: 999999 // Max area so it sorts to the bottom/background accurately
                                    });
                                }
                                // End drag
                                state.dragFrom = null;
                                state.dragPos = null;
                                break;
                            } else {
                                // Advance drag to next step
                                state.dragFrom = stepTarget;
                                prevDot = stepTarget;
                                continue;
                            }
                        }

                        // DRAW MODE LOGIC
                        // Check if this new line created a cycle in the global graph!
                        const cyclePath = findCycle(prevDot, stepTarget, currentColor);

                        if (cyclePath) {
                            // Convert string cycle path back to actual dot coordinates
                            const pts = cyclePath.map(str => {
                                const [cx, cy] = str.split(',').map(Number);
                                return { x: cx, y: cy };
                            });

                            // Mark all lines making up this cycle as inPolygon
                            for (let p = 0; p < cyclePath.length - 1; p++) {
                                const [x1, y1] = cyclePath[p].split(',').map(Number);
                                const [x2, y2] = cyclePath[p + 1].split(',').map(Number);
                                const edge = state.lines.find(l =>
                                    (l.x1 === x1 && l.y1 === y1 && l.x2 === x2 && l.y2 === y2) ||
                                    (l.x1 === x2 && l.y1 === y2 && l.x2 === x1 && l.y2 === y1)
                                );
                                if (edge) edge.inPolygon = true;
                            }
                            newLine.inPolygon = true; // The one we just drew

                            // Calculate area using Shoelace formula
                            let area = 0;
                            for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
                                area += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
                            }
                            area = Math.abs(area / 2);

                            state.fills.push({
                                points: pts,
                                color: currentColor,
                                area: area
                            });

                            // Stop interpolating if we closed a loop
                            state.dragFrom = null;
                            state.dragPos = null;
                            state.chainDots = [];
                            break;
                        } else {
                            // Just an open line
                            state.chainDots.push(stepTarget);
                            state.dragFrom = stepTarget; // update dragFrom for continuous drag
                            prevDot = stepTarget;
                        }
                    }
                }
            }
            render();

            // Sync my drag state (throttled)
            if (gameState.players[myNetworkId]) {
                gameState.players[myNetworkId].dragFrom = state.dragFrom;
                gameState.players[myNetworkId].dragPos = state.dragPos;
                gameState.players[myNetworkId].color = currentColor;
                if (typeof broadcastDragUpdate === 'function') broadcastDragUpdate();
            }
        }

        function onEnd(e) {
            // Just drop — the continuous drag already committed lines in onMove
            state.dragFrom = null;
            state.dragPos = null;
            // Keep hoverPos as e might still be a mouse over event
            if (e.type && e.type.indexOf('mouse') === 0) {
                state.hoverPos = getPos(e);
            } else {
                state.hoverPos = null;
            }
            render();

            // Clear my drag state
            if (gameState.players[myNetworkId]) {
                gameState.players[myNetworkId].dragFrom = null;
                gameState.players[myNetworkId].dragPos = null;
            }

            if (typeof broadcastStateUpdate === 'function') broadcastStateUpdate(true);
        }

        canvas.addEventListener('mousedown', onStart);
        canvas.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onEnd);
        canvas.addEventListener('mouseleave', () => {
            state.hoverPos = null;
            render();
        });
        canvas.addEventListener('touchstart', onStart, { passive: false });
        canvas.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('touchend', onEnd, { passive: false });

        // Arrow key controls for Game Mode
        window.addEventListener('keydown', (e) => {
            if (state.mode !== 'game') return;
            if (!gameState.active || !gameState.players[myNetworkId] || !gameState.players[myNetworkId].alive) return;

            // Block page scroll when arrow keys used in game mode
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                e.preventDefault();
            }

            switch (e.key) {
                case 'ArrowUp': moveUserGame(0, -1); break;
                case 'ArrowDown': moveUserGame(0, 1); break;
                case 'ArrowLeft': moveUserGame(-1, 0); break;
                case 'ArrowRight': moveUserGame(1, 0); break;
            }
        });

        function drawBackground() {
            const dpr = window.devicePixelRatio || 1;
            const w = canvas.width / dpr;
            const h = canvas.height / dpr;

            ctx.fillStyle = '#f4f4f6';
            ctx.fillRect(0, 0, w, h);
        }

        function drawFills() {
            // Sort fills by descending area so small regions are drawn on top of large overlapping regions
            const sortedFills = [...state.fills].sort((a, b) => b.area - a.area);

            sortedFills.forEach(f => {
                if (f.points.length < 3) return;

                ctx.save();
                ctx.globalAlpha = state.mode === 'number' ? 0.4 : 1.0; // Make fills semi-transparent ONLY in number mode

                ctx.beginPath();
                ctx.moveTo(f.points[0].x, f.points[0].y);
                f.points.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
                ctx.closePath();

                ctx.fillStyle = f.color;
                ctx.fill('evenodd');

                // Draw faint stroke purely to prevent anti-aliasing gaps between joined shapes
                ctx.lineWidth = 1;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.strokeStyle = f.color;
                ctx.stroke();

                ctx.restore();
            });
        }

        function drawLines() {
            // In copy mode use thicker lines that fully cover grid dots
            ctx.lineWidth = (state.mode === 'copy') ? 6 : 4;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            state.lines.forEach(l => {
                if (l.inPolygon) return; // Hide lines that are inside a polygon to prevent border overlapping
                ctx.beginPath();
                ctx.moveTo(l.x1, l.y1);
                ctx.lineTo(l.x2, l.y2);
                ctx.strokeStyle = l.color;
                ctx.stroke();
            });
        }

        function drawGridDots() {
            const dpr = window.devicePixelRatio || 1;
            const w = canvas.width / dpr;
            const h = canvas.height / dpr;

            // Collect all focus positions (drags and hovers) from all players
            const focusPositions = [];
            if (state.dragPos || state.hoverPos) focusPositions.push(state.dragPos || state.hoverPos);
            
            for (const [id, player] of Object.entries(gameState.players)) {
                if (id === myNetworkId) continue;
                if (player.dragPos) focusPositions.push(player.dragPos);
            }

            for (let x = GRID_SPACING; x < w; x += GRID_SPACING) {
                for (let y = GRID_SPACING; y < h; y += GRID_SPACING) {
                    let radius = 3.5;
                    
                    // If ANY player is near this dot, grow it
                    const isNear = focusPositions.some(pos => Math.hypot(x - pos.x, y - pos.y) < SNAP_RADIUS);
                    if (isNear) {
                        radius = 8;
                    }

                    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)'; // Faint uniform grey/shadow
                    ctx.beginPath();
                    ctx.arc(x, y, radius, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }

        function drawGhost() {
            if (state.mode === 'game') return; // Hide ghost line during game mode movement

            // Draw ghost lines for all players who are currently dragging
            for (const player of Object.values(gameState.players)) {
                if (!player.dragFrom || !player.dragPos) continue;
                
                const from = player.dragFrom;
                const to = player.dragPos;

                ctx.save();
                // Dashed ghost line
                ctx.beginPath();
                ctx.moveTo(from.x, from.y);
                ctx.lineTo(to.x, to.y);
                ctx.strokeStyle = player.color || '#ffffff';
                ctx.lineWidth = 3;
                ctx.globalAlpha = 0.55;
                ctx.setLineDash([8, 8]);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.restore();
            }

            // Local ghost line fallback if not in players list or for ultra-responsiveness
            // (But usually myNetworkId is in gameState.players anyway)
            if (state.dragFrom && state.dragPos && !gameState.players[myNetworkId]) {
                const from = state.dragFrom;
                const to = state.dragPos;
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(from.x, from.y);
                ctx.lineTo(to.x, to.y);
                ctx.strokeStyle = currentColor;
                ctx.lineWidth = 3;
                ctx.globalAlpha = 0.55;
                ctx.setLineDash([8, 8]);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.restore();
            }
        }

        function drawNumbers() {
            if (state.mode !== 'number' || !state.templatePoints || state.templatePoints.length === 0) return;

            // Exclude the very last point if it's identical to the start point (closed loop)
            const len = state.templatePoints.length;
            const last = state.templatePoints[len - 1];
            const first = state.templatePoints[0];
            const drawLen = (first.x === last.x && first.y === last.y) ? len - 1 : len;

            for (let i = 0; i < drawLen; i++) {
                const p = state.templatePoints[i];

                // In Number mode, we draw the template dots ON TOP of everything (so they aren't hidden by the background image if shapes overlap)
                ctx.fillStyle = '#010101';
                ctx.beginPath();
                ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
                ctx.fill();

                // Draw number slightly offset above/left of the dot
                ctx.fillStyle = '#010101';
                ctx.font = 'bold 16px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText((i + 1).toString(), p.x - 15, p.y - 15);
            }
        }

        function drawGameTerritories() {
            if (!gameState.active) return;
            const offset = GRID_SPACING / 2; // to center the square on the dot

            for (const player of Object.values(gameState.players)) {
                if (!player.alive && player.territory.length === 0) continue;
                ctx.fillStyle = player.color;
                player.territory.forEach(p => {
                    ctx.fillRect(p.x - offset, p.y - offset, GRID_SPACING, GRID_SPACING);
                });
            }
        }

        function drawGameTrails() {
            if (!gameState.active) return;
            ctx.lineWidth = 6;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            for (const player of Object.values(gameState.players)) {
                if (!player.alive || player.trail.length === 0) continue;
                ctx.strokeStyle = player.color;
                ctx.beginPath();
                ctx.moveTo(player.trail[0].x, player.trail[0].y);
                player.trail.forEach(p => ctx.lineTo(p.x, p.y));
                ctx.stroke();

                // Draw Head
                const head = player.trail[player.trail.length - 1];
                ctx.fillStyle = '#ffffff';
                ctx.beginPath(); ctx.arc(head.x, head.y, 6, 0, Math.PI * 2); ctx.fill();
                ctx.lineWidth = 2; ctx.stroke();
            }
        }

        function isPointInPolygon(point, vs) {
            // Raycasting algorithm
            let x = point.x, y = point.y + 0.1; // Add tiny offset to avoid perfectly hitting grid vertices
            let inside = false;
            for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
                let xi = vs[i].x, yi = vs[i].y;
                let xj = vs[j].x, yj = vs[j].y;
                let intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
                if (intersect) inside = !inside;
            }
            return inside;
        }

        function moveUserGame(dx, dy) {
            if (!gameState.active || !gameState.players[myNetworkId]) return;
            const player = gameState.players[myNetworkId];
            if (!player.alive) return;

            const dpr = window.devicePixelRatio || 1;
            const maxGridX = Math.floor((canvas.width / dpr) / GRID_SPACING) * GRID_SPACING;
            const maxGridY = Math.floor((canvas.height / dpr) / GRID_SPACING) * GRID_SPACING;

            if (player.trail.length === 0) {
                if (player.territory.length > 0) {
                    // start from border of territory
                    const startNode = player.territory[0];
                    player.trail.push({ x: startNode.x, y: startNode.y });
                } else {
                    return;
                }
            }

            const head = player.trail[player.trail.length - 1];
            const nextX = head.x + Math.sign(dx) * GRID_SPACING;
            const nextY = head.y + Math.sign(dy) * GRID_SPACING;

            // Strict Bounds Check — matching AI!
            if (nextX < GRID_SPACING || nextY < GRID_SPACING || nextX >= maxGridX || nextY >= maxGridY) return;

            if (player.trail.length > 1) {
                const neck = player.trail[player.trail.length - 2];
                if (neck.x === nextX && neck.y === nextY) return;
            }

            if (player.trail.find(t => t.x === nextX && t.y === nextY)) {
                eliminatePlayer(myNetworkId);
                return;
            }

            player.trail.push({ x: nextX, y: nextY });

            if (player.territory.find(t => t.x === nextX && t.y === nextY)) {
                captureGameTerritory(myNetworkId);
                // Don't lose position! Keep the head dot so Arrow Keys continue smoothly from here.
                player.trail = [{ x: nextX, y: nextY }];
            } else {
                for (const [id, opp] of Object.entries(gameState.players)) {
                    if (id === myNetworkId) continue;
                    if (opp.trail.find(t => t.x === nextX && t.y === nextY)) {
                        eliminatePlayer(id);
                    }
                }
            }

            render();
            if (typeof broadcastStateUpdate === 'function') broadcastStateUpdate(true);
        }

        function captureGameTerritory(playerId) {
            const player = gameState.players[playerId];
            if (player.trail.length < 3) return; // Too small

            const trailPts = player.trail;
            const poly = [...trailPts];
            // Close the loop by connecting end back to start
            poly.push(trailPts[0]);

            const dpr = window.devicePixelRatio || 1;
            const w = canvas.width / dpr;
            const h = canvas.height / dpr;

            // Find bounding box for optimization
            let minX = w, minY = h, maxX = 0, maxY = 0;
            poly.forEach(p => {
                if (p.x < minX) minX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.x > maxX) maxX = p.x;
                if (p.y > maxY) maxY = p.y;
            });

            const newTerritory = [];
            // Iterate all grid dots in bounding box
            for (let x = Math.max(GRID_SPACING, snapToGrid(minX, 0).x); x <= Math.min(w, snapToGrid(maxX, 0).x); x += GRID_SPACING) {
                for (let y = Math.max(GRID_SPACING, snapToGrid(0, minY).y); y <= Math.min(h, snapToGrid(0, maxY).y); y += GRID_SPACING) {
                    // Skip if already ours
                    if (player.territory.find(t => t.x === x && t.y === y)) continue;

                    if (isPointInPolygon({ x, y }, poly)) {
                        newTerritory.push({ x, y });

                        // Steal from ANY opponent
                        for (const [id, opp] of Object.entries(gameState.players)) {
                            if (id === playerId) continue;
                            const oppIdx = opp.territory.findIndex(t => t.x === x && t.y === y);
                            if (oppIdx !== -1) opp.territory.splice(oppIdx, 1);
                        }
                    }
                }
            }

            // Add trail itself as territory too
            trailPts.forEach(p => {
                if (!player.territory.find(t => t.x === p.x && t.y === p.y)) {
                    newTerritory.push({ x: p.x, y: p.y });
                    // Steal from opponents
                    for (const [id, opp] of Object.entries(gameState.players)) {
                        if (id === playerId) continue;
                        const oppIdx = opp.territory.findIndex(t => t.x === p.x && t.y === p.y);
                        if (oppIdx !== -1) opp.territory.splice(oppIdx, 1);
                    }
                }
            });

            player.territory = player.territory.concat(newTerritory);

            // Check for Perm-Death scenarios (Opponent lost all territory)
            for (const [id, opp] of Object.entries(gameState.players)) {
                if (id === playerId) continue;
                if (opp.territory.length === 0 && opp.alive) {
                    opp.alive = false;
                    opp.trail = [];
                    console.log(id + " WAS PERMANENTLY ELIMINATED BY " + playerId);
                }
            }
        }

        // ─── Assign starting territory (module-level so respawn timer can call it) ──
        function assignTerritory(id) {
            const dpr = window.devicePixelRatio || 1;
            const w = canvas.width / dpr;
            const h = canvas.height / dpr;
            const maxGridX = Math.floor(w / GRID_SPACING) * GRID_SPACING;
            const maxGridY = Math.floor(h / GRID_SPACING) * GRID_SPACING;

            const corners = [
                { x: GRID_SPACING, y: maxGridY - GRID_SPACING * 3 }, // Bottom-Left
                { x: GRID_SPACING, y: GRID_SPACING }, // Top-Left
                { x: maxGridX - GRID_SPACING * 3, y: maxGridY - GRID_SPACING * 3 }, // Bottom-Right
                { x: maxGridX - GRID_SPACING * 3, y: GRID_SPACING } // Top-Right (reserved for AI)
            ];

            const pts = [];
            let startX, startY;

            if (id === 'ai') {
                // AI starts at top-right corner
                startX = corners[3].x;
                startY = corners[3].y;
            } else {
                // Use join-order (playerOrder) for stable corner assignment.
                // This avoids alphabetical-sort collisions where two players could
                // get the same index (and thus the same corner).
                if (!gameState.playerOrder.includes(id)) {
                    gameState.playerOrder.push(id);
                }
                const myIdx = gameState.playerOrder.indexOf(id);

                // Map human players to the first 3 corners (0, 1, 2)
                const corner = corners[myIdx % 3];
                startX = corner.x;
                startY = corner.y;
            }

            for (let x = startX; x <= startX + GRID_SPACING * 2; x += GRID_SPACING) {
                for (let y = startY; y <= startY + GRID_SPACING * 2; y += GRID_SPACING) {
                    if (y > 0 && x > 0 && y < maxGridY && x < maxGridX) pts.push({ x, y });
                }
            }
            if (gameState.players[id]) {
                gameState.players[id].territory = pts;
            }
        }

        let gameWon = false; // Guard: ensure confetti fires only once per game session

        function checkForWinner() {
            if (gameWon || state.mode !== 'game' || !gameState.active) return;

            const alivePlayers = Object.entries(gameState.players)
                .filter(([id, p]) => !p.isAI && p.alive);

            if (alivePlayers.length === 1) {
                // Last human standing — fire confetti exactly once!
                gameWon = true;
                gameState.active = false; // Stop further moves
                const confettiCanvas = document.getElementById('confetti-canvas');
                if (confettiCanvas && typeof confetti !== 'undefined') {
                    const myConfetti = confetti.create(confettiCanvas, { resize: true, useWorker: true });
                    myConfetti({
                        particleCount: 150,
                        spread: 120,
                        origin: { x: 0.5, y: 0.6 }
                    });
                    setTimeout(() => { if (typeof confetti !== 'undefined') confetti.reset(); }, 4000);
                }
                if (typeof broadcastStateUpdate === 'function') broadcastStateUpdate(true);
            }
        }

        function eliminatePlayer(playerId) {
            const player = gameState.players[playerId];
            if (!player) return;
            player.alive = false;
            player.trail = [];
            player.territory = []; // Clear their territory so it disappears from the map
            if (player.isAI) {
                if (gameState.aiInterval) {
                    clearInterval(gameState.aiInterval);
                    gameState.aiInterval = null;
                }
            }
            console.log(playerId + ' was ELIMINATED!');
            render(); // Immediately re-render to remove the territory visually
            // Broadcast the elimination immediately so all clients see it
            if (typeof broadcastStateUpdate === 'function') broadcastStateUpdate(true);
            // Check if the game is now over
            checkForWinner();
        }

        function aiTick() {
            if (!gameState.active) return;
            const ai = gameState.players['ai'];
            if (!ai || !ai.alive) return;
            const speed = GRID_SPACING;

            // 1. If no trail, start one from the edge of AI territory
            if (ai.trail.length === 0 && ai.territory.length > 0) {
                // Find a border dot (has at least one empty neighbor)
                for (let t of ai.territory) {
                    const neighbors = [
                        { x: t.x + speed, y: t.y }, { x: t.x - speed, y: t.y },
                        { x: t.x, y: t.y + speed }, { x: t.x, y: t.y - speed }
                    ];
                    const emptyN = neighbors.find(n => !ai.territory.find(at => at.x === n.x && at.y === n.y));
                    if (emptyN) {
                        ai.trail.push({ x: t.x, y: t.y });
                        ai.trail.push({ x: emptyN.x, y: emptyN.y });
                        ai.currentTarget = { x: emptyN.x, y: emptyN.y };
                        break;
                    }
                }
                render();
                return;
            }

            // 2. Extend trail
            const head = ai.trail[ai.trail.length - 1];

            // Allowed moves from head (up, down, left, right)
            let candidates = [
                { x: head.x + speed, y: head.y }, { x: head.x - speed, y: head.y },
                { x: head.x, y: head.y + speed }, { x: head.x, y: head.y - speed }
            ];

            const dpr = window.devicePixelRatio || 1;
            const w = (canvas.width / dpr) - GRID_SPACING;
            const h = (canvas.height / dpr) - GRID_SPACING;

            // Filter valid moves (using maxGridX/Y to avoid exactly hitting the boundary)
            const maxGridX = Math.floor((canvas.width / dpr) / GRID_SPACING) * GRID_SPACING;
            const maxGridY = Math.floor((canvas.height / dpr) / GRID_SPACING) * GRID_SPACING;
            candidates = candidates.filter(c => {
                // Stay within the valid grid dots bounds
                if (c.x < GRID_SPACING || c.x >= maxGridX || c.y < GRID_SPACING || c.y >= maxGridY) return false;
                // Don't hit own trail
                if (ai.trail.find(t => t.x === c.x && t.y === c.y)) return false;
                return true;
            });

            if (candidates.length === 0) {
                // Trapped and dead
                ai.trail = [];
                return;
            }

            let nextMove = null;

            // 3. Behavior: if trail is getting long (> 15), bias towards returning to own territory
            if (ai.trail.length > 15) {
                const homeMoves = candidates.filter(c => ai.territory.find(t => t.x === c.x && t.y === c.y));
                if (homeMoves.length > 0) {
                    nextMove = homeMoves[0]; // Hit home!
                } else {
                    // Pick move that minimizes distance to closest territory point
                    candidates.sort((a, b) => {
                        let d1 = Math.min(...ai.territory.map(t => Math.hypot(t.x - a.x, t.y - a.y)));
                        let d2 = Math.min(...ai.territory.map(t => Math.hypot(t.x - b.x, t.y - b.y)));
                        return d1 - d2;
                    });
                    nextMove = candidates[0];
                }
            } else {
                // Target-based movement
                if (!ai.currentTarget) {
                    // Find a random target grid point strictly inside the grid
                    const rx = Math.floor(Math.random() * ((maxGridX / GRID_SPACING) - 1) + 1) * GRID_SPACING;
                    const ry = Math.floor(Math.random() * ((maxGridY / GRID_SPACING) - 1) + 1) * GRID_SPACING;
                    if (rx > 0 && ry > 0) {
                        ai.currentTarget = { x: rx, y: ry };
                    }
                }

                if (ai.currentTarget) {
                    candidates.sort((a, b) => {
                        const d1 = Math.hypot(a.x - ai.currentTarget.x, a.y - ai.currentTarget.y);
                        const d2 = Math.hypot(b.x - ai.currentTarget.x, b.y - ai.currentTarget.y);
                        return d1 - d2;
                    });
                    nextMove = candidates[0];

                    // If we reached the target or close to it, clear it
                    if (Math.hypot(head.x - ai.currentTarget.x, head.y - ai.currentTarget.y) < GRID_SPACING) {
                        ai.currentTarget = null;
                    }
                } else {
                    nextMove = candidates[Math.floor(Math.random() * candidates.length)];
                }
            }

            ai.trail.push(nextMove);

            // Capture check
            if (ai.territory.find(t => t.x === nextMove.x && t.y === nextMove.y)) {
                captureGameTerritory('ai');
                ai.trail = []; // Done exploring, reset
                ai.currentTarget = null; // Clear target after capture
            }

            // Kill check (Did AI run into ANY opponent's active trail?)
            for (const [id, opp] of Object.entries(gameState.players)) {
                if (id === 'ai') continue;
                if (opp.trail.find(t => t.x === nextMove.x && t.y === nextMove.y)) {
                    eliminatePlayer('ai');
                    break;
                }
            }

            render();
        }

        let renderCount = 0;
        function render() {
            // Compositor flush: Touch a DOM attribute on the canvas to force the browser 
            // to realize the layer is dirty even if the window isn't focused.
            renderCount++;
            canvas.setAttribute('data-render-count', renderCount);

            drawBackground();

            if (state.mode === 'game') {
                drawGameTerritories(); // Draw solid square blocks
                drawGridDots(); // Draw dots over the territories so it's clear
                drawGameTrails(); // Draw the active lines
                updateGameProgressBar();
            } else if (state.mode === 'copy') {
                drawCopyModeSplit();
                drawFills();       // Fill underneath
                drawGridDots();    // Dots on top of fill
                drawLines();       // Lines cover dots they pass through
                drawGhost();
                updateCopyProgressBar();
            } else {
                drawGridDots();
                drawFills();
                drawLines();
                drawNumbers();
                drawGhost();
            }
        }

        function drawCopyModeSplit() {
            if (!copyState.active) return;
            const dpr = window.devicePixelRatio || 1;
            const w = canvas.width / dpr;
            const h = canvas.height / dpr;
            const midX = copyState.dividerX;

            // Draw divider line
            ctx.save();
            ctx.strokeStyle = '#555';
            ctx.lineWidth = 3;
            ctx.setLineDash([10, 6]);
            ctx.beginPath();
            ctx.moveTo(midX, 0);
            ctx.lineTo(midX, h);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();

            // Label left and right
            ctx.save();
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            ctx.font = 'bold 18px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('YOUR DRAWING', midX / 2, 30);
            ctx.fillText('REPLICATE THIS', midX + midX / 2, 30);
            ctx.restore();

            // Draw the target shape as a solid filled painting on the right half
            if (copyState.targetPoints.length > 2) {
                ctx.save();

                // 1. Solid opaque fill
                ctx.beginPath();
                ctx.moveTo(copyState.targetPoints[0].x, copyState.targetPoints[0].y);
                copyState.targetPoints.forEach(p => ctx.lineTo(p.x, p.y));
                ctx.closePath();
                ctx.fillStyle = copyState.targetColor;
                ctx.fill();

                // 2. Border outline (same color as fill)
                ctx.lineWidth = 4;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.strokeStyle = copyState.targetColor;
                ctx.stroke();

                ctx.restore();
            }

            // Draw a START DOT on the left side at the mirrored first target point
            if (copyState.targetPoints.length > 0 && state.lines.length === 0) {
                const startX = copyState.targetPoints[0].x - midX;
                const startY = copyState.targetPoints[0].y;
                ctx.save();
                // Start dot matching the target painting color
                ctx.fillStyle = copyState.targetColor;
                ctx.beginPath();
                ctx.arc(startX, startY, 8, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 2;
                ctx.stroke();
                // Label
                ctx.fillStyle = copyState.targetColor;
                ctx.font = 'bold 12px Arial';
                ctx.textAlign = 'center';
                ctx.fillText('START', startX, startY + 20); // Beneath the dot
                ctx.restore();
            }
        }

        function initCopyMode() {
            copyState.active = true;
            const dpr = window.devicePixelRatio || 1;
            const w = canvas.width / dpr;
            const h = canvas.height / dpr;

            // Ensure the split divider is perfectly aligned with the grid
            const midX = Math.round((w / 2) / GRID_SPACING) * GRID_SPACING;
            copyState.dividerX = midX;

            // Simple shapes using only neighboring grid steps (no diagonal jumps)
            // Each shape is defined in grid-unit offsets from origin (0,0)
            const G = GRID_SPACING;
            const simpleShapes = [
                { name: 'Square', pts: [{ x: 0, y: 0 }, { x: G * 3, y: 0 }, { x: G * 3, y: G * 3 }, { x: 0, y: G * 3 }, { x: 0, y: 0 }] },
                { name: 'Rectangle', pts: [{ x: 0, y: 0 }, { x: G * 4, y: 0 }, { x: G * 4, y: G * 2 }, { x: 0, y: G * 2 }, { x: 0, y: 0 }] },
                { name: 'L-Shape', pts: [{ x: 0, y: 0 }, { x: G * 2, y: 0 }, { x: G * 2, y: G }, { x: G, y: G }, { x: G, y: G * 3 }, { x: 0, y: G * 3 }, { x: 0, y: 0 }] },
                { name: 'T-Shape', pts: [{ x: 0, y: 0 }, { x: G * 4, y: 0 }, { x: G * 4, y: G }, { x: G * 3, y: G }, { x: G * 3, y: G * 3 }, { x: G, y: G * 3 }, { x: G, y: G }, { x: 0, y: G }, { x: 0, y: 0 }] },
                { name: 'U-Shape', pts: [{ x: 0, y: 0 }, { x: G, y: 0 }, { x: G, y: G * 2 }, { x: G * 3, y: G * 2 }, { x: G * 3, y: 0 }, { x: G * 4, y: 0 }, { x: G * 4, y: G * 3 }, { x: 0, y: G * 3 }, { x: 0, y: 0 }] },
                { name: 'Cross', pts: [{ x: G, y: 0 }, { x: G * 2, y: 0 }, { x: G * 2, y: G }, { x: G * 3, y: G }, { x: G * 3, y: G * 2 }, { x: G * 2, y: G * 2 }, { x: G * 2, y: G * 3 }, { x: G, y: G * 3 }, { x: G, y: G * 2 }, { x: 0, y: G * 2 }, { x: 0, y: G }, { x: G, y: G }, { x: G, y: 0 }] },
                { name: 'Steps', pts: [{ x: 0, y: 0 }, { x: G * 2, y: 0 }, { x: G * 2, y: G }, { x: G * 3, y: G }, { x: G * 3, y: G * 2 }, { x: G * 4, y: G * 2 }, { x: G * 4, y: G * 3 }, { x: 0, y: G * 3 }, { x: 0, y: 0 }] }
            ];

            // Pick random shape and color
            const chosen = simpleShapes[Math.floor(Math.random() * simpleShapes.length)];
            copyState.templateName = chosen.name;
            copyState.targetColor = COPY_COLORS[Math.floor(Math.random() * COPY_COLORS.length)];

            // Center the shape on the right half
            let sMinX = Infinity, sMinY = Infinity, sMaxX = -Infinity, sMaxY = -Infinity;
            chosen.pts.forEach(p => {
                if (p.x < sMinX) sMinX = p.x;
                if (p.y < sMinY) sMinY = p.y;
                if (p.x > sMaxX) sMaxX = p.x;
                if (p.y > sMaxY) sMaxY = p.y;
            });
            const shapeW = sMaxX - sMinX;
            const shapeH = sMaxY - sMinY;
            const centerRightX = midX + (w - midX) / 2;
            const centerY = h / 2;
            const baseX = Math.round((centerRightX - shapeW / 2) / GRID_SPACING) * GRID_SPACING;
            const baseY = Math.round((centerY - shapeH / 2) / GRID_SPACING) * GRID_SPACING;

            copyState.targetPoints = chosen.pts.map(p => ({
                x: baseX + p.x,
                y: baseY + p.y
            }));

            // Build lines from consecutive points, interpolating intermediate segments
            copyState.targetLines = [];
            for (let i = 0; i < copyState.targetPoints.length - 1; i++) {
                const p1 = copyState.targetPoints[i];
                const p2 = copyState.targetPoints[i + 1];

                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                const dist = Math.hypot(dx, dy);
                const steps = Math.round(dist / GRID_SPACING);

                if (steps > 0) {
                    for (let s = 0; s < steps; s++) {
                        copyState.targetLines.push({
                            x1: p1.x + (dx / steps) * s,
                            y1: p1.y + (dy / steps) * s,
                            x2: p1.x + (dx / steps) * (s + 1),
                            y2: p1.y + (dy / steps) * (s + 1)
                        });
                    }
                }
            }
        }

        function updateCopyProgressBar() {
            if (!copyState.active || copyState.targetLines.length === 0) return;

            const bar = document.getElementById('copy-progress-bar');
            if (!bar) return;

            const dpr = window.devicePixelRatio || 1;
            const w = canvas.width / dpr;
            const midX = copyState.dividerX;

            // For each target line on the right, check if user drew a matching
            // line on the left (right coords minus midX = expected left coords)
            const targetCount = copyState.targetLines.length;
            let matchedCount = 0;
            const tolerance = GRID_SPACING * 0.4; // Strict tolerance to avoid matching distant lines

            for (const tLine of copyState.targetLines) {
                const expectedX1 = tLine.x1 - midX;
                const expectedY1 = tLine.y1;
                const expectedX2 = tLine.x2 - midX;
                const expectedY2 = tLine.y2;

                const matched = state.lines.some(uLine => {
                    // Check both orientations of the user's line
                    const d1a = Math.hypot(uLine.x1 - expectedX1, uLine.y1 - expectedY1);
                    const d1b = Math.hypot(uLine.x2 - expectedX2, uLine.y2 - expectedY2);
                    const d2a = Math.hypot(uLine.x1 - expectedX2, uLine.y1 - expectedY2);
                    const d2b = Math.hypot(uLine.x2 - expectedX1, uLine.y2 - expectedY1);
                    return (d1a < tolerance && d1b < tolerance) || (d2a < tolerance && d2b < tolerance);
                });

                if (matched) matchedCount++;
            }

            const percent = Math.min(100, Math.round((matchedCount / targetCount) * 100));
            bar.style.width = percent + '%';
            bar.style.backgroundColor = copyState.targetColor;

            if (percent >= 100 && !copyState.won) {
                bar.innerText = '100% \u2728 Perfect Match!';
                copyState.won = true;
                // Fire confetti!
                const confettiCanvas = document.getElementById('confetti-canvas');
                if (confettiCanvas && typeof confetti !== 'undefined') {
                    const myConfetti = confetti.create(confettiCanvas, { resize: true, useWorker: true });
                    myConfetti({
                        particleCount: 150,
                        spread: 120,
                        origin: { x: 0.5, y: 0.6 }
                    });
                    setTimeout(() => { confetti.reset(); }, 4000);
                }
            } else if (percent < 100) {
                bar.innerText = percent + '% matched';
                copyState.won = false;
            }
        }

        function updateGameProgressBar() {
            const dpr = window.devicePixelRatio || 1;
            const w = canvas.width / dpr;
            const h = canvas.height / dpr;

            // Find the maximum valid grid area
            const maxGridX = Math.floor(w / GRID_SPACING) * GRID_SPACING;
            const maxGridY = Math.floor(h / GRID_SPACING) * GRID_SPACING;
            const totalValidDots = (maxGridX / GRID_SPACING) * (maxGridY / GRID_SPACING);

            const container = document.getElementById('game-progress-container');
            if (!container) return;

            container.innerHTML = ''; // Clear old static bars

            for (const [id, player] of Object.entries(gameState.players)) {
                const score = player.territory.length;
                if (score === 0 && !player.alive) continue;

                const percent = Math.min(100, Math.round((score / totalValidDots) * 100));

                const bar = document.createElement('div');
                bar.style.height = '100%';
                bar.style.width = percent + '%';
                bar.style.backgroundColor = player.color;
                bar.style.display = 'flex';
                bar.style.alignItems = 'center';
                bar.style.justifyContent = 'center';
                bar.style.overflow = 'hidden';
                bar.style.whiteSpace = 'nowrap';
                bar.style.boxSizing = 'border-box';
                bar.style.transition = 'width 0.3s';

                // Only show text if wide enough
                if (percent > 2) {
                    bar.innerText = percent + '%';
                }

                container.appendChild(bar);
            }
        }

        // ─── Toolbar buttons ──────────────────────────────────────────────────────
        // Color Palette toggle and selection
        const colorBtn = document.getElementById('color-button');
        const colorPalette = document.getElementById('color-palette');
        const colorSwatches = document.querySelectorAll('.color-swatch');

        // Helper to handle both mouse and touch without double-firing
        function bindTap(el, handler) {
            if (!el) return;
            el.addEventListener('mousedown', handler);
            el.addEventListener('touchstart', (e) => {
                e.preventDefault(); // Prevent emulated mousedown
                handler(e);
            });
        }

        if (colorBtn && colorPalette) {
            bindTap(colorBtn, (e) => {
                e.stopPropagation();
                colorPalette.style.display = colorPalette.style.display === 'none' ? 'flex' : 'none';
            });

            colorSwatches.forEach(swatch => {
                bindTap(swatch, (e) => {
                    e.stopPropagation();
                    currentColor = swatch.dataset.color || '#ffffff';
                    colorPalette.style.display = 'none';

                    // Update game mode player color and synchronize
                    if (state.mode === 'game' && gameState.players[myNetworkId]) {
                        gameState.players[myNetworkId].color = currentColor;
                        if (typeof broadcastStateUpdate === 'function') broadcastStateUpdate(true);
                    }
                    render();
                });
            });

            // Hide palette when tapping anywhere else
            window.addEventListener('mousedown', () => {
                colorPalette.style.display = 'none';
            });
            window.addEventListener('touchstart', () => {
                colorPalette.style.display = 'none';
            });
        }

        const mainModeBtn = document.getElementById('main-mode-button');
        const modePalette = document.getElementById('mode-palette');
        const drawBtn = document.getElementById('draw-mode-button');
        const numBtn = document.getElementById('number-mode-button');
        const gameBtn = document.getElementById('game-mode-button');

        if (mainModeBtn && modePalette) {
            bindTap(mainModeBtn, (e) => {
                e.stopPropagation();
                if (colorPalette) colorPalette.style.display = 'none'; // hide others
                modePalette.style.display = modePalette.style.display === 'none' ? 'flex' : 'none';
            });

            function updateModeUI(modeName) {
                const templateBtn = document.getElementById('template-button');
                const templatePalette = document.getElementById('template-palette');
                const saveImageBtn = document.getElementById('save-image-button');
                if (templateBtn) {
                    templateBtn.style.display = modeName === 'number' ? 'inline-block' : 'none';
                    if (modeName !== 'number' && templatePalette) templatePalette.style.display = 'none';
                }
                if (saveImageBtn) {
                    saveImageBtn.style.display = (modeName === 'draw' || modeName === 'number') ? 'inline-block' : 'none';
                }

                const progressContainer = document.getElementById('game-progress-container');
                if (progressContainer) progressContainer.style.display = (modeName === 'game') ? 'flex' : 'none';

                const copyProgressContainer = document.getElementById('copy-progress-container');
                if (copyProgressContainer) copyProgressContainer.style.display = (modeName === 'copy') ? 'flex' : 'none';

                if (aiButton) {
                    if (modeName !== 'game') {
                        aiButton.style.display = 'none';
                    } else {
                        aiButton.style.display = 'inline-block';
                        if (presence && !isHost) aiButton.style.opacity = '0.5';
                        else aiButton.style.opacity = '1';

                        if (gameState.aiActive) aiButton.classList.add('active');
                        else aiButton.classList.remove('active');
                    }
                }

                const undoBtn = document.getElementById('undo-button');
                const clearBtn = document.getElementById('clear-button');
                if (undoBtn) undoBtn.style.display = (modeName === 'copy' || modeName === 'draw' || modeName === 'number') ? 'inline-block' : 'none';
                if (clearBtn) clearBtn.style.display = (modeName === 'copy' || modeName === 'draw') ? 'inline-block' : 'none';

                if (mainModeBtn) {
                    if (modeName === 'draw') mainModeBtn.style.backgroundImage = 'url(icons/free-paint.svg)';
                    else if (modeName === 'number') mainModeBtn.style.backgroundImage = 'url(icons/challenge.svg)';
                    else if (modeName === 'game') mainModeBtn.style.backgroundImage = 'url(icons/difficulty.svg)';
                    else if (modeName === 'copy') mainModeBtn.style.backgroundImage = 'url(icons/copy-mode.svg)';
                }
            }

            const setMode = (e, iconUrl, modeName) => {
                e.stopPropagation();
                modePalette.style.display = 'none';

                state.mode = modeName;
                updateModeUI(modeName);

                // On mode swap, clear drawn canvas state
                state.dots = [];
                state.lines = [];
                state.fills = [];
                state.chainDots = [];
                state.dragFrom = null;
                state.dragPos = null;

                if (state.mode === 'number') {
                    loadTemplate(0);
                } else if (state.mode === 'game') {
                    initGameMode();
                } else if (state.mode === 'copy') {
                    copyState.active = false;
                    copyState.won = false;
                    if (gameState.aiInterval) clearInterval(gameState.aiInterval);
                    gameState.active = false;
                    initCopyMode();
                } else {
                    copyState.active = false;
                    if (gameState.aiInterval) clearInterval(gameState.aiInterval);
                    gameState.active = false;
                }

                render();
                if (typeof broadcastStateUpdate === 'function') broadcastStateUpdate(true);
            };

            if (drawBtn) bindTap(drawBtn, (e) => setMode(e, 'icons/free-paint.svg', 'draw'));
            if (numBtn) bindTap(numBtn, (e) => setMode(e, 'icons/challenge.svg', 'number'));
            if (gameBtn) bindTap(gameBtn, (e) => setMode(e, 'icons/difficulty.svg', 'game'));
            const replicateBtn = document.getElementById('copy-mode-button');
            if (replicateBtn) bindTap(replicateBtn, (e) => setMode(e, 'icons/copy-mode.svg', 'copy'));

            // Undo button: restore last snapshot
            const undoButton = document.getElementById('undo-button');
            if (undoButton) bindTap(undoButton, (e) => {
                e.stopPropagation();
                if (undoStack.length > 0) {
                    const prev = JSON.parse(undoStack.pop());
                    state.dots = prev.dots; state.lines = prev.lines; state.fills = prev.fills; state.chainDots = prev.chainDots;
                    if (prev.connectedTargetIndex !== undefined) state.connectedTargetIndex = prev.connectedTargetIndex;
                    if (prev.won !== undefined) copyState.won = prev.won;
                    // Evaluate copy mode progress in case we undo a correct stroke
                    if (state.mode === 'copy') {
                        const bar = document.getElementById('copy-progress-bar');
                        if (bar && state.lines.length === 0) { bar.style.width = '0%'; bar.innerText = '0%'; }
                    }
                    render();
                    if (typeof broadcastStateUpdate === 'function') broadcastStateUpdate(true);
                }
            });

            // Clear button: clear drawing (in copy mode also pick new shape)
            const clearButton = document.getElementById('clear-button');
            if (clearButton) bindTap(clearButton, (e) => {
                e.stopPropagation();
                // Save state before clearing so they can undo the clear!
                saveSnapshot();

                state.dots = [];
                state.lines = [];
                state.fills = [];
                state.chainDots = [];
                state.dragFrom = null;
                state.dragPos = null;
                if (state.mode === 'copy') {
                    copyState.won = false;
                    initCopyMode();
                    const bar = document.getElementById('copy-progress-bar');
                    if (bar) { bar.style.width = '0%'; bar.innerText = '0%'; }
                }
                render();
                if (typeof broadcastStateUpdate === 'function') broadcastStateUpdate(true);
            });

            // Save as Image button
            const saveImageButton = document.getElementById('save-image-button');
            if (saveImageButton) bindTap(saveImageButton, (e) => {
                e.stopPropagation();

                const mimetype = 'image/png';
                const inputData = canvas.toDataURL(mimetype, 1);

                env.getEnvironment(function (err, environment) {
                    let name = environment.user ? environment.user.name : "User";
                    const metadata = {
                        mimetype: mimetype,
                        title: name + "'s ConnectTheDots Drawing",
                        activity: "org.olpcfrance.MediaViewerActivity",
                        timestamp: new Date().getTime(),
                        creation_time: new Date().getTime(),
                        file_size: 0
                    };

                    datastore.create(metadata, function () {
                        console.log("Image saved to journal successfully!");
                        // Visual feedback: humane toast message
                        humane.log(l10n.get('PaintImageSaved') || "Image saved to journal!");
                    }, inputData);
                });
            });

            if (aiButton) bindTap(aiButton, (e) => {
                e.stopPropagation();
                if (!isHost && presence) return; // Only host can toggle inside network
                gameState.aiActive = !gameState.aiActive;
                if (aiButton) aiButton.classList.toggle('active', gameState.aiActive);

                if (gameState.aiActive) {
                    // Always create fresh AI player when enabling
                    gameState.players['ai'] = { color: '#007fff', territory: [], trail: [], alive: true, isAI: true, currentTarget: null };
                    assignTerritory('ai');
                    if (gameState.aiInterval) clearInterval(gameState.aiInterval);
                    gameState.aiInterval = setInterval(aiTick, 450);
                } else {
                    if (gameState.players['ai']) {
                        delete gameState.players['ai']; // Fully remove so re-enable creates fresh
                    }
                    if (gameState.aiInterval) {
                        clearInterval(gameState.aiInterval);
                        gameState.aiInterval = null;
                    }
                }
                render();
                if (typeof broadcastStateUpdate === 'function') broadcastStateUpdate(true);
            });

            function initGameMode() {
                gameState.active = true;
                gameState.lastMoveTime = {};

                // Only host or standalone initializes the core board state
                if (!presence || isHost) {
                    // Snapshot peer IDs (players already connected but not the host)
                    // so we can pre-assign their corners in join-order AFTER the host
                    // takes corner 0. This handles the case where peers joined before
                    // game mode was activated.
                    const existingPeerIds = Object.keys(gameState.players)
                        .filter(p => p !== 'ai' && p !== myNetworkId);

                    gameState.players = {};
                    gameState.playerOrder = []; // Reset join-order on fresh game start
                    // If shared, default AI to off. If local, default to on.
                    gameState.aiActive = !presence;

                    // Host always goes first → corner 0
                    if (!currentColor || currentColor === '#ffffff') currentColor = '#ff8c00';
                    gameState.players[myNetworkId] = { color: currentColor, territory: [], trail: [], alive: true, isAI: false };
                    assignTerritory(myNetworkId); // pushes myNetworkId → playerOrder[0]

                    // Pre-assign corners for already-connected peers in stable order
                    for (const pid of existingPeerIds) {
                        gameState.players[pid] = { color: '#ff8c00', territory: [], trail: [], alive: true, isAI: false };
                        assignTerritory(pid); // pushes each pid → playerOrder[1], [2] …
                    }

                    // AI (only for host/standalone)
                    if (gameState.aiActive) {
                        if (!gameState.players['ai']) {
                            gameState.players['ai'] = { color: '#007fff', territory: [], trail: [], alive: true, isAI: true, currentTarget: null };
                            assignTerritory('ai');
                        }
                        if (gameState.aiInterval) clearInterval(gameState.aiInterval);
                        gameState.aiInterval = setInterval(aiTick, 450);
                    }
                } else {
                    // Non-host joined: ensure local player exists (territory will come from host via init)
                    if (!currentColor || currentColor === '#ffffff') currentColor = '#ff8c00';
                    if (!gameState.players[myNetworkId]) {
                        gameState.players[myNetworkId] = { color: currentColor, territory: [], trail: [], alive: true, isAI: false };
                    } else {
                        gameState.players[myNetworkId].alive = true;
                        gameState.players[myNetworkId].trail = [];
                    }
                }

                updateModeUI('game');

                // If connected, sync the updated board (includes pre-assigned peer territories)
                if (typeof broadcastStateUpdate === 'function') broadcastStateUpdate(true);
            }

            // Hide palette when tapping anywhere else
            window.addEventListener('mousedown', () => {
                modePalette.style.display = 'none';
            });
            window.addEventListener('touchstart', () => {
                modePalette.style.display = 'none';
            });
        }

        function loadTemplate(index) {
            if (!state.templates[index]) return;
            currentTemplateIndex = index;
            state.templatePoints = state.templates[index].points;
            state.connectedTargetIndex = 0;

            // In number mode, "dots" are pre-populated by the template
            state.dots = [...state.templatePoints];
        }

        // Template dropdown button
        const templateBtn = document.getElementById('template-button');
        const templatePalette = document.getElementById('template-palette');
        if (templateBtn && templatePalette) {
            bindTap(templateBtn, (e) => {
                e.stopPropagation();
                if (document.getElementById('color-palette')) document.getElementById('color-palette').style.display = 'none';
                if (document.getElementById('mode-palette')) document.getElementById('mode-palette').style.display = 'none';
                templatePalette.style.display = templatePalette.style.display === 'none' ? 'flex' : 'none';
            });

            const swatches = document.querySelectorAll('.template-swatch');
            swatches.forEach(swatch => {
                bindTap(swatch, (e) => {
                    e.stopPropagation();
                    let nextIndex = parseInt(swatch.dataset.index, 10);
                    if (isNaN(nextIndex)) return;
                    templatePalette.style.display = 'none';

                    // Reset everything
                    state.dots = [];
                    state.lines = [];
                    state.fills = [];
                    state.chainDots = [];
                    state.dragFrom = null;
                    state.dragPos = null;

                    loadTemplate(nextIndex);
                    render();
                });
            });

            // Hide palette when tapping anywhere else
            window.addEventListener('mousedown', () => {
                templatePalette.style.display = 'none';
            });
            window.addEventListener('touchstart', () => {
                templatePalette.style.display = 'none';
            });

            // Function to rebuild template palette buttons (since we might add new ones)
            function refreshTemplatePalette() {
                templatePalette.innerHTML = '';
                const svgIcons = [
                    'icons/shape-star.svg',
                    'icons/shape-house.svg',
                    'icons/shape-square.svg',
                    'icons/shape-diamond.svg',
                    'icons/shape-hexagon.svg'
                ];
                state.templates.forEach((tmpl, idx) => {
                    const btn = document.createElement('button');
                    btn.className = 'toolbutton template-swatch';
                    btn.dataset.index = idx;
                    btn.title = ['Star', 'House', 'Square', 'Diamond', 'Hexagon'][idx] || 'Shape';
                    btn.style.backgroundImage = `url(${svgIcons[idx] || 'icons/shape-square.svg'})`;
                    bindTap(btn, (e) => {
                        e.stopPropagation();
                        templatePalette.style.display = 'none';
                        state.dots = [];
                        state.lines = [];
                        state.fills = [];
                        state.chainDots = [];
                        state.dragFrom = null;
                        state.dragPos = null;
                        loadTemplate(idx);
                        render();
                    });
                    templatePalette.appendChild(btn);
                });
            }
            refreshTemplatePalette();
            window.refreshTemplatePalette = refreshTemplatePalette;
        }

        // Save template button
        const saveTemplateBtn = document.getElementById('save-template-button');
        if (saveTemplateBtn) bindTap(saveTemplateBtn, (e) => {
            if (state.fills.length === 0) {
                alert('Draw and close a shape first!');
                return;
            }
            // Take the last closed shape
            const lastFill = state.fills[state.fills.length - 1];
            const newTmplPoints = [...lastFill.points, lastFill.points[0]]; // Close the loop

            state.templates.push({
                points: newTmplPoints
            });

            if (window.refreshTemplatePalette) window.refreshTemplatePalette();
            alert('Template saved! Switch to Number Mode to play it.');
        });

        // ─── Stop button (close activity) ──────────────────────────────────────────
        const stopBtn = document.getElementById('stop-button');
        if (stopBtn) stopBtn.addEventListener('click', () => {
            if (typeof activity !== 'undefined' && activity.close) {
                activity.close();
            } else {
                window.close();
                // Fallback if window.close() is blocked
                window.history.back();
            }
        });



        function mergeLines(newLines) {
            if (!Array.isArray(newLines)) return;
            newLines.forEach(nl => {
                // Bidirectional check: (p1->p2) is the same as (p2->p1)
                const exists = state.lines.find(l => 
                    (l.x1 === nl.x1 && l.y1 === nl.y1 && l.x2 === nl.x2 && l.y2 === nl.y2) ||
                    (l.x1 === nl.x2 && l.y1 === nl.y2 && l.x2 === nl.x1 && l.y2 === nl.y1)
                );
                if (!exists) state.lines.push(nl);
            });
        }

        function mergeDots(newDots) {
            if (!Array.isArray(newDots)) return;
            newDots.forEach(nd => {
                const exists = state.dots.find(d => d.x === nd.x && d.y === nd.y);
                if (!exists) state.dots.push(nd);
            });
        }

        resizeCanvas();

        // --- Network / Presence Logic ---
        let presence = null;
        let isHost = false;

        function onNetworkDataReceived(msg) {
            // Use saved myNetworkId for self-filter (presence.getUserInfo() may not
            // be available on the joiner's wrapper object).
            if (msg.user.networkId === myNetworkId) {
                return;
            }

            switch (msg.content.action) {
                case 'init': {
                    Object.assign(state, msg.content.data.state);
                    // Merge gameState properties but PRESERVE our local player entry
                    const incomingGS = msg.content.data.gameState;
                    if (incomingGS) {
                        if (incomingGS.active !== undefined) gameState.active = incomingGS.active;
                        if (incomingGS.aiActive !== undefined) gameState.aiActive = incomingGS.aiActive;
                        if (Array.isArray(incomingGS.playerOrder)) gameState.playerOrder = incomingGS.playerOrder;
                        
                        // Merge players — do NOT replace the whole object
                        if (incomingGS.players) {
                            for (const [pid, pdata] of Object.entries(incomingGS.players)) {
                                if (pid !== myNetworkId) { // Never overwrite ourselves with stale host data
                                    gameState.players[pid] = pdata;
                                }
                            }
                        }
                    }

                    // Always ensure local player exists in the players list, regardless of mode.
                    // This is CRITICAL for broadcastDragUpdate to function.
                    if (!gameState.players[myNetworkId]) {
                        if (!currentColor || currentColor === '#ffffff') {
                            currentColor = (state.mode === 'game') ? '#ff8c00' : currentColor;
                        }
                        gameState.players[myNetworkId] = { color: currentColor, territory: [], trail: [], alive: true, isAI: false };
                    }

                    if (state.mode === 'game' && gameState.active) {
                        if (gameState.players[myNetworkId].territory.length === 0) {
                            // Host created our slot but territory is still empty — assign it.
                            assignTerritory(myNetworkId);
                        }
                        // Apply our real color (from Sugarizer env) to our slot
                        gameState.players[myNetworkId].color = currentColor;
                        if (typeof broadcastStateUpdate === 'function') broadcastStateUpdate();
                    }

                    updateModeUI(state.mode);
                    render();
                    break;
                }
                case 'drag_update': {
                    const senderId = msg.user.networkId;
                    if (!gameState.players[senderId]) {
                        gameState.players[senderId] = { color: msg.content.data.color, territory: [], trail: [], alive: true, isAI: false };
                    }
                    gameState.players[senderId].dragFrom = msg.content.data.dragFrom;
                    gameState.players[senderId].dragPos = msg.content.data.dragPos;
                    gameState.players[senderId].color = msg.content.data.color;
                    
                    // Merge rather than replace to avoid clobbering concurrent drawings
                    if (msg.content.data.lines) {
                        mergeLines(msg.content.data.lines);
                        mergeDots(msg.content.data.dots);
                        if (msg.content.data.connectedTargetIndex !== undefined) {
                            state.connectedTargetIndex = msg.content.data.connectedTargetIndex;
                        }
                    }

                    render();
                    break;
                }
                case 'state_update': {
                    // Sync non-drawing state
                    if (msg.content.data.state && msg.content.data.state.mode) {
                        state.mode = msg.content.data.state.mode;
                    }

                    // Merge drawing state to preserve multi-user edits
                    mergeDots(msg.content.data.state.dots);
                    mergeLines(msg.content.data.state.lines);
                    if (Array.isArray(msg.content.data.state.fills)) {
                        state.fills = msg.content.data.state.fills; // Fills are usually discrete, replacement is okay
                    }

                    // Merge ONLY the sender's game player and AI (if host sent it)
                    const senderId = msg.user.networkId;
                    if (msg.content.data.gameState) {
                        // Sync the active flag so game rendering (drawGameTerritories etc.) runs on all clients
                        if (msg.content.data.gameState.active !== undefined) {
                            gameState.active = msg.content.data.gameState.active;
                        }
                        // Sync playerOrder so self-assignment fallback uses the correct corner index
                        if (Array.isArray(msg.content.data.gameState.playerOrder)) {
                            gameState.playerOrder = msg.content.data.gameState.playerOrder;
                        }
                        if (msg.content.data.gameState.players) {
                            // Propagate dead/eliminated state for ALL known players (not just sender).
                            // This ensures eliminations are visible on every client's screen.
                            for (const [pid, pdata] of Object.entries(msg.content.data.gameState.players)) {
                                if (pid === 'ai') continue; // handled separately below
                                if (!pdata.alive && gameState.players[pid] && gameState.players[pid].alive) {
                                    // Remote player was eliminated — apply dead state locally
                                    gameState.players[pid].alive = false;
                                    gameState.players[pid].trail = [];
                                    gameState.players[pid].territory = pdata.territory || [];
                                }
                            }
                            // Sender's full current data (position, territory, trail)
                            if (msg.content.data.gameState.players[senderId]) {
                                gameState.players[senderId] = msg.content.data.gameState.players[senderId];
                            }
                            if (msg.content.data.gameState.players['ai']) {
                                gameState.players['ai'] = msg.content.data.gameState.players['ai'];
                            }
                        }
                        if (msg.content.data.gameState.aiActive !== undefined) {
                            gameState.aiActive = msg.content.data.gameState.aiActive;
                        }
                    }

                    // If we just entered game mode by someone else's switch, and we aren't spawned, spawn!
                    if (state.mode === 'game' && gameState.active) {
                        // NOTE: do NOT force gameState.active = true here.
                        // It is already correctly synced from the sender above.
                        // Overriding it would undo a game-over (active=false) broadcast.
                        if (!gameState.players[myNetworkId]) {
                            if (!currentColor || currentColor === '#ffffff') currentColor = '#ff8c00';
                            gameState.players[myNetworkId] = { color: currentColor, territory: [], trail: [], alive: true, isAI: false };
                        }
                        if (gameState.players[myNetworkId].territory.length === 0) {
                            // playerOrder is now synced from the sender, so assignTerritory
                            // will pick the correct corner index (not defaulting to 0).
                            assignTerritory(myNetworkId);
                            if (typeof broadcastStateUpdate === 'function') broadcastStateUpdate();
                        }
                    }

                    // Check if the game has ended (e.g. remote elimination broadcast was received)
                    checkForWinner();

                    updateModeUI(state.mode);
                    render();
                    break;
                }
            }
        }

        function onNetworkUserChanged(msg) {
            if (isHost && msg.move === 1) {
                const newId = msg.user.networkId;

                // If in game mode, pre-assign a corner for the new player
                // BEFORE broadcasting init, so the joiner receives their territory
                // directly from the host (avoiding self-assignment race conditions).
                if (state.mode === 'game' && gameState.active) {
                    if (!gameState.players[newId]) {
                        gameState.players[newId] = { color: '#ff8c00', territory: [], trail: [], alive: true, isAI: false };
                    }
                    if (gameState.players[newId].territory.length === 0) {
                        assignTerritory(newId); // also pushes newId into playerOrder
                    }
                }

                presence.sendMessage(presence.getSharedInfo().id, {
                    user: presence.getUserInfo(),
                    content: {
                        action: 'init',
                        data: { state: state, gameState: gameState }
                    }
                });
            }
        }

        let broadcastTimeout = null;
        function broadcastStateUpdate(immediate = false) {
            if (!presence) return;

            const sendPayload = () => {
                presence.sendMessage(presence.getSharedInfo().id, {
                    user: presence.getUserInfo(),
                    content: {
                        action: 'state_update',
                        data: { state: state, gameState: gameState }
                    }
                });
                broadcastTimeout = null;
            };

            if (immediate) {
                if (broadcastTimeout) clearTimeout(broadcastTimeout);
                sendPayload();
            } else {
                if (!broadcastTimeout) {
                    broadcastTimeout = setTimeout(sendPayload, 100); // 100ms network throttle
                }
            }
        }
        
        let dragTimeout = null;
        function broadcastDragUpdate() {
            if (!presence || dragTimeout) return;

            dragTimeout = setTimeout(() => {
                // Only send the heavy lines/dots array if we are actually dragging (drawing)
                const isDragging = (state.dragFrom !== null);
                
                presence.sendMessage(presence.getSharedInfo().id, {
                    user: presence.getUserInfo(),
                    content: {
                        action: 'drag_update',
                        data: {
                            dragFrom: state.dragFrom,
                            dragPos: state.dragPos,
                            color: currentColor,
                            lines: isDragging ? state.lines : null,
                            dots: isDragging ? state.dots : null,
                            connectedTargetIndex: state.connectedTargetIndex
                        }
                    }
                });
                dragTimeout = null;
            }, 40); // 40ms throttle for smooth drag
        }

        // Wrap the original render and input functions to broadcast updates
        // (Removed originalRender wrapper to prevent infinite broadcast loops)

        activity.setup();

        const networkButton = document.getElementById("network-button");
        if (networkButton) {
            const currentPresencePalette = new presencepalette.PresencePalette(networkButton, undefined);
            currentPresencePalette.addEventListener('shared', function () {
                currentPresencePalette.popDown();
                presence = activity.getPresenceObject(function (error, network) {
                    if (error) return;
                    myNetworkId = network.getUserInfo().networkId;
                    network.createSharedActivity('org.sugarlabs.ConnectTheDots', function (groupId) {
                        isHost = true;
                    });
                    network.onDataReceived(onNetworkDataReceived);
                    network.onSharedActivityUserChanged(onNetworkUserChanged);

                    // Initialize local player in gameState
                    if (!gameState.players[myNetworkId]) {
                        gameState.players[myNetworkId] = { color: currentColor, territory: [], trail: [], alive: true, isAI: false };
                    }
                });
            });
        }

        env.getEnvironment(function (err, environment) {
            // Setup localization
            var defaultLanguage = (typeof chrome != 'undefined' && chrome.app && chrome.app.runtime) ? chrome.i18n.getUILanguage() : navigator.language;
            var language = environment.user ? environment.user.language : defaultLanguage;
            if (l10n && l10n.init) l10n.init(language);

            // Shared instances detection
            if (environment.sharedId) {
                presence = activity.getPresenceObject(function (error, network) {
                    if (error) return;
                    presence = network; // Explicit assignment inside callback
                    myNetworkId = network.getUserInfo().networkId;
                    network.onDataReceived(onNetworkDataReceived);
                    network.onSharedActivityUserChanged(onNetworkUserChanged);

                    // Initialize local player in gameState
                    if (!gameState.players[myNetworkId]) {
                        gameState.players[myNetworkId] = { color: currentColor, territory: [], trail: [], alive: true, isAI: false };
                    }
                });
            }
            if (environment.user && environment.user.colorvalue) {
                // Setup the User's color dynamically Syncing with Sugarizer Env!
                currentColor = environment.user.colorvalue.fill || currentColor;
                if (gameState.players[myNetworkId]) {
                    gameState.players[myNetworkId].color = currentColor;
                }
                render();
            }
        });

        // Heartbeat Render Loop (10 FPS)
        // Ensures that background/split-screen windows eventually repaint 
        // even if the compositor is throttled. Very low overhead.
        setInterval(render, 100);

    });

});
