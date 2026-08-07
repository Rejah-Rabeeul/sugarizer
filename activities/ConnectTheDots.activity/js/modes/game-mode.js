define([], function () {
	var dots = [];
	var spacing = 55;
	var offsetX = 0;
	var offsetY = 0;

	// Grid
	var COLS = 15;
	var ROWS = 13;

	var user = null;
	var ai = null;

	var isGameActive = false;
	var speed = 0.04; // Grid units per frame (for slower speed)

	var isMouseDown = false;

	// Add keyboard listener
	window.addEventListener('keydown', function (e) {
		if (!isGameActive || !user || user.isDead) return;
		if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
			user.nextDir = { x: 0, y: -1 };
		} else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
			user.nextDir = { x: 0, y: 1 };
		} else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
			user.nextDir = { x: -1, y: 0 };
		} else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
			user.nextDir = { x: 1, y: 0 };
		}
	});

	function initPlayer(isAi, startCol, startRow, color, headColor, dirX, dirY) {
		var territory = new Set();
		if (startCol >= 0 && startCol < COLS && startRow >= 0 && startRow < ROWS) {
			territory.add(startCol + "_" + startRow);
		}
		return {
			isAi: isAi,
			col: startCol,
			row: startRow,
			dir: { x: dirX, y: dirY },
			nextDir: { x: dirX, y: dirY },
			color: color,
			headColor: headColor,
			territory: territory,
			trail: [], // array of {c, r} points
			isDead: false,
			lastSafe: { c: startCol, r: startRow }
		};
	}

	function restartGame() {
		user = initPlayer(false, 2, 2, '#005fe4', '#003380', 1, 0);
		ai = initPlayer(true, COLS - 3, ROWS - 3, '#ff2b34', '#990000', -1, 0);
		isGameActive = true;
	}

	function getBaseCoords(col, row) {
		return {
			x: offsetX + col * spacing,
			y: offsetY + row * spacing
		};
	}

	// Flood fill to capture territory
	function captureTerritory(player) {
		if (player.trail.length === 0) return;

		// Trail loop closed, create the boundary
		var boundary = new Set(player.territory);
		var minC = COLS, maxC = -1, minR = ROWS, maxR = -1;

		for (var i = 0; i < player.trail.length; i++) {
			var pt = player.trail[i];
			boundary.add(pt.c + "_" + pt.r);
		}

		// Add trail to territory first
		for (var i = 0; i < player.trail.length; i++) {
			player.territory.add(player.trail[i].c + "_" + player.trail[i].r);
		}
		player.trail = [];

		// Identify enclosed territory using an outward flood fill (BFS).
		// By starting the fill from the grid's outer edges, we map all "outside" space.
		// Any coordinate the fill cannot reach must therefore be enclosed inside the player's loop.

		var visited = new Set();
		var queue = [];

		// Add all grid edges to queue if not part of boundary
		for (var c = 0; c < COLS; c++) {
			if (!boundary.has(c + "_0")) queue.push({ c: c, r: 0 });
			if (!boundary.has(c + "_" + (ROWS - 1))) queue.push({ c: c, r: ROWS - 1 });
		}
		for (var r = 1; r < ROWS - 1; r++) {
			if (!boundary.has("0_" + r)) queue.push({ c: 0, r: r });
			if (!boundary.has((COLS - 1) + "_" + r)) queue.push({ c: COLS - 1, r: r });
		}

		for (var i = 0; i < queue.length; i++) {
			visited.add(queue[i].c + "_" + queue[i].r);
		}

		while (queue.length > 0) {
			var curr = queue.shift();
			var neighbors = [
				{ c: curr.c + 1, r: curr.r }, { c: curr.c - 1, r: curr.r },
				{ c: curr.c, r: curr.r + 1 }, { c: curr.c, r: curr.r - 1 }
			];
			for (var i = 0; i < neighbors.length; i++) {
				var n = neighbors[i];
				if (n.c >= 0 && n.c < COLS && n.r >= 0 && n.r < ROWS) {
					var key = n.c + "_" + n.r;
					if (!visited.has(key) && !boundary.has(key)) {
						visited.add(key);
						queue.push(n);
					}
				}
			}
		}

		// Anything not visited and not boundary is captured
		for (var c = 0; c < COLS; c++) {
			for (var r = 0; r < ROWS; r++) {
				var key = c + "_" + r;
				if (!visited.has(key) && !boundary.has(key)) {
					player.territory.add(key);
					// If captured from opponent, remove it from opponent's territory
					var opp = player.isAi ? user : ai;
					if (opp.territory.has(key)) {
						opp.territory.delete(key);
					}
				}
			}
		}

		// Also remove trail points from opponent's territory if stolen
		var opp = player.isAi ? user : ai;
		boundary.forEach(function (key) {
			if (player.territory.has(key) && opp.territory.has(key)) {
				opp.territory.delete(key);
			}
		});
	}

	function triggerConfetti() {
		if (typeof confetti === 'function') {
			confetti({
				particleCount: 150,
				spread: 100,
				origin: { x: 0.5, y: 0.5 }
			});
		}
	}

	function checkEliminations() {
		if (!isGameActive) return;

		var checkCollision = function (p, opp) {
			var state = { pDead: false, oppDead: false };

			// To check p Hit wall
			if (p.hitWall) {
				state.pDead = true;
				return state;
			}

			var headC = Math.round(p.col);
			var headR = Math.round(p.row);
			if (Math.abs(p.col - headC) < 0.2 && Math.abs(p.row - headR) < 0.2) {
				// To check if p hit opp's trail
				for (var i = 0; i < opp.trail.length; i++) {
					if (opp.trail[i].c === headC && opp.trail[i].r === headR) {
						state.oppDead = true; // Opponent's trail was hit, opponent eliminates
					}
				}
				// To check if p hit its own trail
				for (var i = 0; i < p.trail.length - 1; i++) { // exclude head
					if (p.trail[i].c === headC && p.trail[i].r === headR) {
						state.pDead = true; // Hit own trail, p eliminates
					}
				}
			}
			return state;
		};

		var userStatus = checkCollision(user, ai);
		var aiStatus = checkCollision(ai, user);

		var userDead = userStatus.pDead || aiStatus.oppDead;
		var aiDead = aiStatus.pDead || userStatus.oppDead;

		// Head to head collision
		if (Math.abs(user.col - ai.col) < 0.5 && Math.abs(user.row - ai.row) < 0.5) {
			if (user.trail.length > 0 && ai.trail.length === 0) userDead = true;
			else if (ai.trail.length > 0 && user.trail.length === 0) aiDead = true;
			else if (user.territory.size < ai.territory.size) userDead = true;
			else aiDead = true;
		}

		if (userDead && aiDead) {
			// If both somehow die, the one with smaller territory loses
			if (user.territory.size < ai.territory.size) { aiDead = false; }
			else { userDead = false; }
		}

		if (userDead) {
			user.isDead = true;
			isGameActive = false;
			user.territory.clear();
			user.trail = [];
		} else if (aiDead) {
			ai.isDead = true;
			isGameActive = false;
			ai.territory.clear();
			ai.trail = [];
			triggerConfetti();
		}
	}

	function updateAI() {
		if (!isGameActive || ai.isDead) return;

		// Only make decisions near grid intersections
		var cInt = Math.round(ai.col);
		var rInt = Math.round(ai.row);
		var dist = Math.abs(ai.col - cInt) + Math.abs(ai.row - rInt);
		if (dist > speed) return;

		// To check if continuing current direction will go out of bounds
		var nextC = cInt + ai.dir.x;
		var nextR = rInt + ai.dir.y;
		var willHitWall = (nextC < 0 || nextC >= COLS || nextR < 0 || nextR >= ROWS);

		// To build trail set for collision avoidance
		var trailSet = new Set();
		for (var i = 0; i < ai.trail.length; i++) trailSet.add(ai.trail[i].c + "_" + ai.trail[i].r);

		// Find all valid directions
		var dirs = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
		var validDirs = [];
		for (var i = 0; i < dirs.length; i++) {
			var d = dirs[i];
			if (d.x === -ai.dir.x && d.y === -ai.dir.y) continue; // no 180
			var nc = cInt + d.x, nr = rInt + d.y;
			if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
			if (trailSet.has(nc + "_" + nr)) continue;
			validDirs.push(d);
		}

		if (validDirs.length === 0) return; // Truly trapped

		// If current direction is still valid and we won't hit a wall,
		// check if we even need to decide
		var currentStillValid = false;
		if (!willHitWall) {
			for (var i = 0; i < validDirs.length; i++) {
				if (validDirs[i].x === ai.dir.x && validDirs[i].y === ai.dir.y) {
					currentStillValid = true;
					break;
				}
			}
		}

		// To check if this direction can reach AI territory
		function canReachTerritory(startC, startR) {
			if (ai.territory.has(startC + "_" + startR)) return true;
			var q = [{ c: startC, r: startR }];
			var vis = new Set();
			vis.add(startC + "_" + startR);
			vis.add(cInt + "_" + rInt);
			while (q.length > 0) {
				var curr = q.shift();
				if (ai.territory.has(curr.c + "_" + curr.r)) return true;
				for (var j = 0; j < dirs.length; j++) {
					var nc2 = curr.c + dirs[j].x, nr2 = curr.r + dirs[j].y;
					var key2 = nc2 + "_" + nr2;
					if (nc2 >= 0 && nc2 < COLS && nr2 >= 0 && nr2 < ROWS) {
						if (!vis.has(key2) && !trailSet.has(key2)) {
							vis.add(key2);
							q.push({ c: nc2, r: nr2 });
						}
					}
				}
			}
			return false;
		}

		// Filter to only directions that can reach territory
		var safeDirs = [];
		for (var i = 0; i < validDirs.length; i++) {
			var nc = cInt + validDirs[i].x;
			var nr = rInt + validDirs[i].y;
			if (canReachTerritory(nc, nr)) {
				safeDirs.push(validDirs[i]);
			}
		}
		if (safeDirs.length > 0) {
			validDirs = safeDirs;
		}

		var inTerritory = ai.territory.has(cInt + "_" + rInt);

		// Only panic when trail is getting too long
		var panic = (ai.trail.length > 6);

		if (panic) {
			// BFS to find shortest path home
			var bfsQueue = [{ c: cInt, r: rInt, dir: null }];
			var bfsVisited = new Set();
			bfsVisited.add(cInt + "_" + rInt);
			var pathDir = null;
			var found = false;

			while (bfsQueue.length > 0) {
				var curr = bfsQueue.shift();
				if (ai.territory.has(curr.c + "_" + curr.r) && !(curr.c === cInt && curr.r === rInt)) {
					pathDir = curr.dir;
					found = true;
					break;
				}
				for (var i = 0; i < dirs.length; i++) {
					var d = dirs[i];
					var nc = curr.c + d.x, nr = curr.r + d.y;
					var key = nc + "_" + nr;
					if (nc >= 0 && nc < COLS && nr >= 0 && nr < ROWS) {
						if (!bfsVisited.has(key) && !trailSet.has(key)) {
							if (curr.dir === null && d.x === -ai.dir.x && d.y === -ai.dir.y) continue;
							bfsVisited.add(key);
							bfsQueue.push({ c: nc, r: nr, dir: curr.dir || d });
						}
					}
				}
			}
			if (found && pathDir) {
				for (var i = 0; i < validDirs.length; i++) {
					if (validDirs[i].x === pathDir.x && validDirs[i].y === pathDir.y) {
						ai.nextDir = pathDir;
						return;
					}
				}
			}
		}

		if (willHitWall || !currentStillValid || Math.random() < 0.3 || inTerritory) {
			var bestDir = null;
			var bestScore = -Infinity;

			for (var i = 0; i < validDirs.length; i++) {
				var d = validDirs[i];
				var nc = cInt + d.x, nr = rInt + d.y;
				var score = 0;

				// To attack user trail
				for (var j = 0; j < user.trail.length; j++) {
					if (user.trail[j].c === nc && user.trail[j].r === nr) score += 1000;
				}

				// To capture user territory
				if (user.territory.has(nc + "_" + nr)) score += 50;

				// Prefer unclaimed squares
				if (!ai.territory.has(nc + "_" + nr)) score += 20;

				// Prefer to keep moving in the same direction
				if (d.x === ai.dir.x && d.y === ai.dir.y) score += 10;

				// penalize moves toward grid edges
				if (nc <= 0 || nc >= COLS - 1) score -= 15;
				if (nr <= 0 || nr >= ROWS - 1) score -= 15;

				// To add randomness for variety
				score += Math.random() * 15;

				if (score > bestScore) {
					bestScore = score;
					bestDir = d;
				}
			}

			if (bestDir) {
				ai.nextDir = bestDir;
			}
		}
	}

	function updatePlayer(p) {
		if (p.isDead) return;

		// Calculate next position
		var newCol = p.col + p.dir.x * speed;
		var newRow = p.row + p.dir.y * speed;

		// Don't allow movement outside the grid (added small margin to prevent floating point deaths)
		var margin = speed * 0.5;
		if (newCol < -margin) { newCol = 0; p.hitWall = true; }
		if (newCol > COLS - 1 + margin) { newCol = COLS - 1; p.hitWall = true; }
		if (newRow < -margin) { newRow = 0; p.hitWall = true; }
		if (newRow > ROWS - 1 + margin) { newRow = ROWS - 1; p.hitWall = true; }

		p.col = newCol;
		p.row = newRow;

		// Checking grid intersection
		var cInt = Math.round(p.col);
		var rInt = Math.round(p.row);
		var dist = Math.abs(p.col - cInt) + Math.abs(p.row - rInt);

		if (dist < speed * 0.75) {
			p.col = cInt;
			p.row = rInt;

			// To handle trail
			var key = cInt + "_" + rInt;
			if (!p.territory.has(key)) {
				// Outside territory, add to trail
				if (p.trail.length === 0 || p.trail[p.trail.length - 1].c !== cInt || p.trail[p.trail.length - 1].r !== rInt) {
					p.trail.push({ c: cInt, r: rInt });
				}
			} else {
				p.lastSafe = { c: cInt, r: rInt };
				// We are in territory, capture if we have a trail
				if (p.trail.length > 0) {
					captureTerritory(p);
				}
			}

			// Apply next direction
			if (!(p.nextDir.x === -p.dir.x && p.nextDir.y === -p.dir.y) &&
				(p.nextDir.x !== p.dir.x || p.nextDir.y !== p.dir.y)) {
				p.dir = p.nextDir;
			}
		}
	}

	function updateGame() {
		if (!isGameActive) return;
		updatePlayer(user);
		updateAI(); // AI decides direction before moving
		updatePlayer(ai);
		checkEliminations();
	}

	function drawRect(ctx, c, r, color, padding) {
		var b = getBaseCoords(c, r);
		ctx.fillStyle = color;
		var s = spacing - padding * 2;
		if (padding === 0) s += 2;
		ctx.fillRect(b.x - s / 2, b.y - s / 2, s, s);
	}

	var GameMode = {
		init: function (dotsArray, broadcastCallback, activitySpacing) {
			dots = dotsArray || [];
			if (activitySpacing !== undefined) {
				spacing = activitySpacing;
			}
			if (dots.length > 0) {
				offsetX = dots[0].baseX;
				offsetY = dots[0].baseY;
				
				var maxCol = 0;
				var maxRow = 0;
				for (var i = 0; i < dots.length; i++) {
					if (dots[i].col > maxCol) maxCol = dots[i].col;
					if (dots[i].row > maxRow) maxRow = dots[i].row;
				}
				COLS = maxCol + 1;
				ROWS = maxRow + 1;
			}
			restartGame();
		},
		activate: function () {
			restartGame();
		},
		deactivate: function () {
			isGameActive = false;
		},
		resize: function () { },

		onMouseDown: function (mouseX, mouseY) {
			if (isGameActive) {
				isMouseDown = true;
			}
		},
		onMouseMove: function (mouseX, mouseY, prevX, prevY) {
			if (!isGameActive || prevX === -1000 || !isMouseDown) return;
			var dx = mouseX - prevX;
			var dy = mouseY - prevY;

			// If dragged pixels, change direction
			if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
				if (Math.abs(dx) > Math.abs(dy)) {
					user.nextDir = dx > 0 ? { x: 1, y: 0 } : { x: -1, y: 0 };
				} else {
					user.nextDir = dy > 0 ? { x: 0, y: 1 } : { x: 0, y: -1 };
				}
			}
		},
		onMouseUp: function () {
			isMouseDown = false;
		},

		drawBehindDots: function (ctx) {
			if (!ctx) return;

			if (dots.length > 0 && offsetX === 0) {
				offsetX = dots[0].baseX;
				offsetY = dots[0].baseY;
			}

			// Update logic
			updateGame();

			// Draw percentage bar
			if (user && ai) {
				var total = COLS * ROWS;
				var userPct = user.territory.size / total;
				var aiPct = ai.territory.size / total;

				var barWidth = (COLS - 1) * spacing;
				var barHeight = 12;
				var startX = offsetX;
				var startY = offsetY - spacing * 0.8;

				ctx.fillStyle = '#e0e0e0'; // Neutral
				ctx.fillRect(startX, startY, barWidth, barHeight);

				if (userPct > 0) {
					ctx.fillStyle = user.color;
					ctx.fillRect(startX, startY, barWidth * userPct, barHeight);
				}

				if (aiPct > 0) {
					ctx.fillStyle = ai.color;
					ctx.fillRect(startX + barWidth - (barWidth * aiPct), startY, barWidth * aiPct, barHeight);
				}
			}

			// Draw territory
			var drawTerritory = function (player) {
				player.territory.forEach(function (key) {
					var parts = key.split("_");
					var c = parseInt(parts[0]);
					var r = parseInt(parts[1]);
					drawRect(ctx, c, r, player.color, 0);
				});
			};
			if (user) drawTerritory(user);
			if (ai) drawTerritory(ai);

			// Draw trails
			var drawTrail = function (player) {
				if (!player || player.trail.length === 0) return;
				ctx.beginPath();
				ctx.strokeStyle = player.color;
				ctx.lineWidth = 15;
				ctx.lineCap = "round";
				ctx.lineJoin = "round";

				var start = (player.lastSafe) ? getBaseCoords(player.lastSafe.c, player.lastSafe.r) : getBaseCoords(player.trail[0].c, player.trail[0].r);
				ctx.moveTo(start.x, start.y);
				for (var i = 0; i < player.trail.length; i++) {
					var pt = getBaseCoords(player.trail[i].c, player.trail[i].r);
					ctx.lineTo(pt.x, pt.y);
				}
				var head = getBaseCoords(player.col, player.row);
				ctx.lineTo(head.x, head.y);
				ctx.stroke();
			};
			drawTrail(user);
			drawTrail(ai);

			// Draw heads
			var drawHead = function (player) {
				if (!player || player.isDead) return;
				var pt = getBaseCoords(player.col, player.row);
				ctx.fillStyle = player.headColor;
				ctx.beginPath();
				ctx.arc(pt.x, pt.y, 12, 0, Math.PI * 2);
				ctx.fill();
			};
			drawHead(user);
			drawHead(ai);
		},

		drawFrontDots: function (ctx) {
			// No front dots rendering needed
		},

		isDotCompleted: function (dot) {
			return false; // keep dots active
		},
		isDrawingActive: function () {
			return true;
		},
		getDotColor: function (dot) {
			if (!user || !ai) return null;
			var key = dot.col + "_" + dot.row;
			if (user.territory.has(key)) return user.color;
			if (ai.territory.has(key)) return ai.color;
			return null;
		},

		// Wave animation
		getPlayerPositions: function () {
			if (!isGameActive || !user || !ai) return [];
			return [
				getBaseCoords(user.col, user.row),
				getBaseCoords(ai.col, ai.row)
			];
		},

		serialize: function () { return {}; },
		deserialize: function () { },
		restart: function () {
			restartGame();
		}
	};

	return GameMode;
});