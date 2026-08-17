define(["sugar-web/graphics/xocolor"], function (xocolor) {
  var dots = [];
  var spacing = 55;
  var offsetX = 0;
  var offsetY = 0;

  // Grid
  var COLS = 15;
  var ROWS = 13;

  var user = null;
  var ai = null;
  var opponents = {};
  var onOpponentCountChangedCb = null;
  var broadcastUpdateCb = null;
  var lastBroadcastTime = 0;

  var isGameActive = false;
  var speed = 0.02; // Grid units per frame (speed)

  var isMouseDown = false;

  var buddyStrokeColor = "#005fe4";
  var buddyFillColor = "#003380";
  var aiStrokeColor = null;
  var aiFillColor = null;

  function initAIColors() {
    if (aiStrokeColor && aiFillColor) return;
    if (xocolor && xocolor.colors) {
      var validPairs = [];
      for (var i = 0; i < xocolor.colors.length; i++) {
        if (
          xocolor.colors[i].stroke.toUpperCase() !==
            buddyStrokeColor.toUpperCase() &&
          xocolor.colors[i].fill.toUpperCase() !== buddyFillColor.toUpperCase()
        ) {
          validPairs.push(xocolor.colors[i]);
        }
      }
      if (validPairs.length > 0) {
        var rnd = validPairs[Math.floor(Math.random() * validPairs.length)];
        aiStrokeColor = rnd.stroke;
        aiFillColor = rnd.fill;
      } else {
        aiStrokeColor = "#ff2b34";
        aiFillColor = "#990000";
      }
    } else {
      aiStrokeColor = "#ff2b34";
      aiFillColor = "#990000";
    }
  }

  // Add keyboard listener
  window.addEventListener("keydown", function (e) {
    if (!isGameActive || !user || user.isDead) return;
    var oldNextDirX = user.nextDir.x;
    var oldNextDirY = user.nextDir.y;

    if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") {
      if (user.dir.y !== 1) user.nextDir = { x: 0, y: -1 };
    } else if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") {
      if (user.dir.y !== -1) user.nextDir = { x: 0, y: 1 };
    } else if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
      if (user.dir.x !== 1) user.nextDir = { x: -1, y: 0 };
    } else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
      if (user.dir.x !== -1) user.nextDir = { x: 1, y: 0 };
    }

    if (
      (user.nextDir.x !== oldNextDirX || user.nextDir.y !== oldNextDirY) &&
      broadcastUpdateCb
    ) {
      broadcastUpdateCb();
    }
  });

  function initPlayer(
    isAi,
    startCol,
    startRow,
    strokeColor,
    fillColor,
    headColor,
    dirX,
    dirY,
  ) {
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
      strokeColor: strokeColor,
      fillColor: fillColor,
      headColor: headColor,
      territory: territory,
      trail: [], // array of {c, r} points
      isDead: false,
      lastSafe: { c: startCol, r: startRow },
    };
  }

  function restartGame(isRobotOn, spawnIndex) {
    spawnIndex = spawnIndex || 0;
    var spawns = [
      { c: 0, r: Math.floor(ROWS / 2), dx: 1, dy: 0 },
      { c: COLS - 1, r: Math.floor(ROWS / 2), dx: -1, dy: 0 },
      { c: Math.floor(COLS / 2), r: 0, dx: 0, dy: 1 },
      { c: Math.floor(COLS / 2), r: ROWS - 1, dx: 0, dy: -1 },
      { c: 0, r: 0, dx: 1, dy: 0 },
      { c: COLS - 1, r: 0, dx: -1, dy: 0 },
      { c: 0, r: ROWS - 1, dx: 1, dy: 0 },
      { c: COLS - 1, r: ROWS - 1, dx: -1, dy: 0 },
    ];
    var sp = spawns[spawnIndex % spawns.length];

    initAIColors();
    user = initPlayer(
      false,
      sp.c,
      sp.r,
      buddyStrokeColor,
      buddyFillColor,
      buddyStrokeColor,
      sp.dx,
      sp.dy,
    );
    if (isRobotOn) {
      var aiSp = spawns[1];
      ai = initPlayer(
        true,
        aiSp.c,
        aiSp.r,
        aiStrokeColor,
        aiFillColor,
        aiStrokeColor,
        aiSp.dx,
        aiSp.dy,
      );
    } else {
      ai = null;
    }
    opponents = {};
    if (onOpponentCountChangedCb) onOpponentCountChangedCb(0);
    isGameActive = true;
  }

  function getBaseCoords(col, row) {
    return {
      x: offsetX + col * spacing,
      y: offsetY + row * spacing,
    };
  }

  // Flood fill to capture territory
  function captureTerritory(player) {
    if (player.trail.length === 0) return;

    // Trail loop closed, create the boundary
    var boundary = new Set(player.territory);
    var minC = COLS,
      maxC = -1,
      minR = ROWS,
      maxR = -1;

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
    // By starting the fill from the grid's outer edges, we map all outside space.
    // Any coordinate the fill cannot reach must therefore be enclosed inside the player's loop.

    var visited = new Set();
    var queue = [];

    // Add all grid edges to queue if not part of boundary
    for (var c = 0; c < COLS; c++) {
      if (!boundary.has(c + "_0")) queue.push({ c: c, r: 0 });
      if (!boundary.has(c + "_" + (ROWS - 1)))
        queue.push({ c: c, r: ROWS - 1 });
    }
    for (var r = 1; r < ROWS - 1; r++) {
      if (!boundary.has("0_" + r)) queue.push({ c: 0, r: r });
      if (!boundary.has(COLS - 1 + "_" + r)) queue.push({ c: COLS - 1, r: r });
    }

    for (var i = 0; i < queue.length; i++) {
      visited.add(queue[i].c + "_" + queue[i].r);
    }

    while (queue.length > 0) {
      var curr = queue.shift();
      var neighbors = [
        { c: curr.c + 1, r: curr.r },
        { c: curr.c - 1, r: curr.r },
        { c: curr.c, r: curr.r + 1 },
        { c: curr.c, r: curr.r - 1 },
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
          if (player !== user && user && user.territory.has(key))
            user.territory.delete(key);
          if (player !== ai && ai && ai.territory.has(key))
            ai.territory.delete(key);
          var keys = Object.keys(opponents);
          for (var i = 0; i < keys.length; i++) {
            var opp = opponents[keys[i]];
            if (player !== opp && opp.territory.has(key))
              opp.territory.delete(key);
          }
        }
      }
    }

    // Also remove trail points from opponent's territory if stolen
    boundary.forEach(function (key) {
      if (player !== user && user && user.territory.has(key))
        user.territory.delete(key);
      if (player !== ai && ai && ai.territory.has(key))
        ai.territory.delete(key);
      var keys = Object.keys(opponents);
      for (var i = 0; i < keys.length; i++) {
        var opp = opponents[keys[i]];
        if (player !== opp && opp.territory.has(key)) opp.territory.delete(key);
      }
    });

    if (player === user && broadcastUpdateCb) {
      broadcastUpdateCb();
    }
  }

  function triggerConfetti() {
    if (typeof confetti === "function") {
      confetti({
        particleCount: 150,
        spread: 100,
        origin: { x: 0.5, y: 0.5 },
      });
    }
  }

  function checkEliminations(isSharedMode) {
    if (!isGameActive) return;

    var checkCollision = function (p, oppList) {
      var state = { pDead: false, oppDead: false };

      // To check p Hit wall
      if (p.hitWall) {
        state.pDead = true;
        return state;
      }

      // To check if trail disconnected from territory or territory eliminated
      if (p.territory.size === 0) {
        state.pDead = true;
      } else if (p.trail.length > 0 && p.lastSafe) {
        var safeKey = p.lastSafe.c + "_" + p.lastSafe.r;
        if (!p.territory.has(safeKey)) {
          state.pDead = true;
        }
      }

      var headC = Math.round(p.col);
      var headR = Math.round(p.row);
      if (Math.abs(p.col - headC) < 0.2 && Math.abs(p.row - headR) < 0.2) {
        // To check if p hit opp's trail
        if (oppList && oppList.length > 0) {
          for (var k = 0; k < oppList.length; k++) {
            var opp = oppList[k];
            for (var i = 0; i < opp.trail.length; i++) {
              if (opp.trail[i].c === headC && opp.trail[i].r === headR) {
                state.oppDead = true; // Opponent's trail was hit, opponent eliminates
                if (!state.deadOpponents) state.deadOpponents = [];
                state.deadOpponents.push(opp);
              }
            }
          }
        }
        // To check if p hit its own trail
        for (var i = 0; i < p.trail.length - 1; i++) {
          // exclude head
          if (p.trail[i].c === headC && p.trail[i].r === headR) {
            state.pDead = true; // Hit own trail, p eliminates
          }
        }
      }
      return state;
    };

    var oppList = [];
    if (isSharedMode) {
      var keys = Object.keys(opponents);
      for (var i = 0; i < keys.length; i++) {
        if (!opponents[keys[i]].isDead) oppList.push(opponents[keys[i]]);
      }
    } else if (ai && !ai.isDead) {
      oppList.push(ai);
    }

    if (user && !user.isDead) {
      var userStatus = checkCollision(user, oppList);
      if (userStatus.pDead) user.isDead = true;
      if (userStatus.oppDead && userStatus.deadOpponents) {
        for (var i = 0; i < userStatus.deadOpponents.length; i++) {
          var deadOpp = userStatus.deadOpponents[i];
          deadOpp.isDead = true;
          deadOpp.territory.clear();
          deadOpp.trail = [];
        }
      }
    }

    if (!isSharedMode && ai && !ai.isDead) {
      var aiStatus = checkCollision(ai, [user]);
      if (aiStatus.pDead) ai.isDead = true;
      if (aiStatus.oppDead) user.isDead = true;
      if (userStatus && userStatus.oppDead) ai.isDead = true;
    } else if (isSharedMode) {
      for (var i = 0; i < oppList.length; i++) {
        var opp = oppList[i];
        var oppStatus = checkCollision(opp, [user]);
        if (oppStatus.oppDead) {
          user.isDead = true;
        }
        if (oppStatus.pDead) {
          opp.isDead = true;
          opp.territory.clear();
          opp.trail = [];
        }
      }
    }

    // Head to head collision
    if (user && !user.isDead) {
      for (var i = 0; i < oppList.length; i++) {
        var opp = oppList[i];
        if (opp.isDead) continue;
        if (
          Math.abs(user.col - opp.col) < 0.5 &&
          Math.abs(user.row - opp.row) < 0.5
        ) {
          if (user.trail.length > 0 && opp.trail.length === 0)
            user.isDead = true;
          else if (opp.trail.length > 0 && user.trail.length === 0) {
            opp.isDead = true;
            opp.territory.clear();
            opp.trail = [];
          } else if (user.territory.size < opp.territory.size)
            user.isDead = true;
          else if (user.territory.size > opp.territory.size) {
            opp.isDead = true;
            opp.territory.clear();
            opp.trail = [];
          } else {
            user.isDead = true;
            opp.isDead = true;
            opp.territory.clear();
            opp.trail = [];
          }
        }
      }
    }

    if (user && user.isDead) {
      if (!isSharedMode) isGameActive = false;
      user.territory.clear();
      user.trail = [];
    } else if (!isSharedMode && ai && ai.isDead) {
      isGameActive = false;
      ai.territory.clear();
      ai.trail = [];
      triggerConfetti();
    }

    if (isSharedMode) {
      // Check if only 1 player is alive
      var aliveCount = 0;
      var oppKeys = Object.keys(opponents);
      for (var i = 0; i < oppKeys.length; i++) {
        if (!opponents[oppKeys[i]].isDead) aliveCount++;
      }
      if (user && !user.isDead) aliveCount++;

      if ((oppKeys.length > 0 || (user && user.isDead)) && aliveCount === 1) {
        isGameActive = false;
        if (user && !user.isDead) {
          triggerConfetti();
        }
      } else if (aliveCount === 0 && oppKeys.length > 0) {
        isGameActive = false;
      }
    }
  }

  function updateAI() {
    if (!isGameActive || ai.isDead) return;

    // Only make decisions near grid intersections
    var cInt = Math.round(ai.col);
    var rInt = Math.round(ai.row);
    var dist = Math.abs(ai.col - cInt) + Math.abs(ai.row - rInt);
    if (dist > speed * 2) return;

    // To check if continuing current direction will go out of bounds
    var nextC = cInt + ai.dir.x;
    var nextR = rInt + ai.dir.y;
    var willHitWall = nextC < 0 || nextC >= COLS || nextR < 0 || nextR >= ROWS;

    // To build trail set for collision avoidance
    var trailSet = new Set();
    for (var i = 0; i < ai.trail.length; i++)
      trailSet.add(ai.trail[i].c + "_" + ai.trail[i].r);

    // Find all valid directions
    var dirs = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ];
    var validDirs = [];
    for (var i = 0; i < dirs.length; i++) {
      var d = dirs[i];
      if (d.x === -ai.dir.x && d.y === -ai.dir.y) continue; // no 180
      var nc = cInt + d.x,
        nr = rInt + d.y;
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
          var nc2 = curr.c + dirs[j].x,
            nr2 = curr.r + dirs[j].y;
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
    var panic = ai.trail.length > 6;

    if (panic) {
      // BFS to find shortest path home
      var bfsQueue = [{ c: cInt, r: rInt, dir: null }];
      var bfsVisited = new Set();
      bfsVisited.add(cInt + "_" + rInt);
      var pathDir = null;
      var found = false;

      while (bfsQueue.length > 0) {
        var curr = bfsQueue.shift();
        if (
          ai.territory.has(curr.c + "_" + curr.r) &&
          !(curr.c === cInt && curr.r === rInt)
        ) {
          pathDir = curr.dir;
          found = true;
          break;
        }
        for (var i = 0; i < dirs.length; i++) {
          var d = dirs[i];
          var nc = curr.c + d.x,
            nr = curr.r + d.y;
          var key = nc + "_" + nr;
          if (nc >= 0 && nc < COLS && nr >= 0 && nr < ROWS) {
            if (!bfsVisited.has(key) && !trailSet.has(key)) {
              if (curr.dir === null && d.x === -ai.dir.x && d.y === -ai.dir.y)
                continue;
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

    if (
      willHitWall ||
      !currentStillValid ||
      Math.random() < 0.3 ||
      inTerritory
    ) {
      var bestDir = null;
      var bestScore = -Infinity;

      for (var i = 0; i < validDirs.length; i++) {
        var d = validDirs[i];
        var nc = cInt + d.x,
          nr = rInt + d.y;
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
    if (newCol < -margin) {
      newCol = 0;
      p.hitWall = true;
    }
    if (newCol > COLS - 1 + margin) {
      newCol = COLS - 1;
      p.hitWall = true;
    }
    if (newRow < -margin) {
      newRow = 0;
      p.hitWall = true;
    }
    if (newRow > ROWS - 1 + margin) {
      newRow = ROWS - 1;
      p.hitWall = true;
    }

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
        if (
          p.trail.length === 0 ||
          p.trail[p.trail.length - 1].c !== cInt ||
          p.trail[p.trail.length - 1].r !== rInt
        ) {
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
      if (
        !(p.nextDir.x === -p.dir.x && p.nextDir.y === -p.dir.y) &&
        (p.nextDir.x !== p.dir.x || p.nextDir.y !== p.dir.y)
      ) {
        p.dir = p.nextDir;
      }
    }
  }

  function updateGame() {
    if (!isGameActive) return;
    updatePlayer(user);

    var isSharedMode =
      Object.keys(opponents).length > 0 ||
      (broadcastUpdateCb &&
        document.getElementById("robot-button").style.display === "none");

    if (!isSharedMode && ai) {
      updateAI();
      updatePlayer(ai);
    } else if (isSharedMode) {
      var keys = Object.keys(opponents);
      for (var i = 0; i < keys.length; i++) {
        var opp = opponents[keys[i]];
        if (!opp.isDead) {
          updatePlayer(opp);
        }
      }
    }

    checkEliminations(isSharedMode);

    // Broadcast after eliminations
    if (isSharedMode) {
      var now = Date.now();
      if (now - lastBroadcastTime > 100) {
        if (broadcastUpdateCb && (!user || !user.isDead)) broadcastUpdateCb();
        lastBroadcastTime = now;
      }
      // Send one final broadcast when user eliminates
      if (user && user.isDead && broadcastUpdateCb && !user.deathBroadcasted) {
        broadcastUpdateCb();
        user.deathBroadcasted = true;
      }
    }
  }

  function drawRect(ctx, c, r, color, padding) {
    var b = getBaseCoords(c, r);
    ctx.fillStyle = color;
    var s = spacing - padding * 2;
    if (padding === 0) s += 2;
    ctx.fillRect(b.x - s / 2, b.y - s / 2, s, s);
  }

  var GameMode = {
    init: function (
      dotsArray,
      broadcastCallback,
      activitySpacing,
      onOpponentCountChanged,
    ) {
      dots = dotsArray || [];
      if (activitySpacing !== undefined) {
        spacing = activitySpacing;
      }
      broadcastUpdateCb = broadcastCallback;
      onOpponentCountChangedCb = onOpponentCountChanged;
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
    resize: function () {},

    onMouseDown: function (mouseX, mouseY) {
      if (isGameActive && user && !user.isDead) {
        isMouseDown = true;

        var headCoords = getBaseCoords(user.col, user.row);
        var dx = mouseX - headCoords.x;
        var dy = mouseY - headCoords.y;

        // Steer towards the clicked position
        if (Math.abs(dx) > Math.abs(dy)) {
          user.nextDir = dx > 0 ? { x: 1, y: 0 } : { x: -1, y: 0 };
        } else {
          user.nextDir = dy > 0 ? { x: 0, y: 1 } : { x: 0, y: -1 };
        }
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
      if (user) {
        var total = COLS * ROWS;
        var userPct = user.territory.size / total;
        var aiPct = ai ? ai.territory.size / total : 0;

        var barWidth = (COLS - 1) * spacing;
        var barHeight = 12;
        var startX = offsetX;
        var startY = offsetY - spacing * 0.8;

        ctx.fillStyle = "#e0e0e0"; // Neutral
        ctx.fillRect(startX, startY, barWidth, barHeight);

        if (userPct > 0) {
          ctx.fillStyle = user.fillColor;
          ctx.fillRect(startX, startY, barWidth * userPct, barHeight);
        }

        var keys = Object.keys(opponents);
        var hasOpponents = keys.length > 0;
        var aiRender = hasOpponents ? opponents[keys[0]] : ai;
        if (aiRender) {
          var aiPct = aiRender.territory.size / total;
          if (aiPct > 0) {
            ctx.fillStyle = aiRender.fillColor;
            ctx.fillRect(
              startX + barWidth - barWidth * aiPct,
              startY,
              barWidth * aiPct,
              barHeight,
            );
          }
        }
      }

      // Draw territory
      var drawTerritory = function (player) {
        if (!player || player.isDead) return;
        player.territory.forEach(function (key) {
          var parts = key.split("_");
          var c = parseInt(parts[0]);
          var r = parseInt(parts[1]);
          drawRect(ctx, c, r, player.fillColor, 0);
        });
      };
      if (user) drawTerritory(user);
      if (ai) drawTerritory(ai);
      var keys = Object.keys(opponents);
      for (var i = 0; i < keys.length; i++) drawTerritory(opponents[keys[i]]);

      // Draw trails
      var drawTrail = function (player) {
        if (!player || player.isDead || player.trail.length === 0) return;
        ctx.beginPath();
        ctx.strokeStyle = player.strokeColor;
        ctx.lineWidth = 15;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        var start = player.lastSafe
          ? getBaseCoords(player.lastSafe.c, player.lastSafe.r)
          : getBaseCoords(player.trail[0].c, player.trail[0].r);
        ctx.moveTo(start.x, start.y);
        for (var i = 0; i < player.trail.length; i++) {
          var pt = getBaseCoords(player.trail[i].c, player.trail[i].r);
          ctx.lineTo(pt.x, pt.y);
        }
        var head = getBaseCoords(player.col, player.row);
        ctx.lineTo(head.x, head.y);
        ctx.stroke();
      };
      if (user) drawTrail(user);
      if (ai) drawTrail(ai);
      var keys = Object.keys(opponents);
      for (var i = 0; i < keys.length; i++) drawTrail(opponents[keys[i]]);
    },

    drawFrontDots: function (ctx) {
      // Draw heads
      var drawHead = function (player) {
        if (!player || player.isDead) return;
        var pt = getBaseCoords(player.col, player.row);
        ctx.fillStyle = player.headColor;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 12, 0, Math.PI * 2);
        ctx.fill();
      };
      if (user) drawHead(user);
      if (ai) drawHead(ai);
      var keys = Object.keys(opponents);
      for (var i = 0; i < keys.length; i++) drawHead(opponents[keys[i]]);
    },

    isDotCompleted: function (dot) {
      return false; // keep dots active
    },
    isDrawingActive: function () {
      return true;
    },
    getDotColor: function (dot) {
      if (!user) return null;
      var key = dot.col + "_" + dot.row;

      for (var i = 0; i < user.trail.length; i++) {
        if (user.trail[i].c === dot.col && user.trail[i].r === dot.row)
          return user.strokeColor;
      }
      if (ai) {
        for (var i = 0; i < ai.trail.length; i++) {
          if (ai.trail[i].c === dot.col && ai.trail[i].r === dot.row)
            return ai.strokeColor;
        }
      }
      var keys = Object.keys(opponents);
      for (var j = 0; j < keys.length; j++) {
        var opp = opponents[keys[j]];
        if (!opp.isDead) {
          for (var i = 0; i < opp.trail.length; i++) {
            if (opp.trail[i].c === dot.col && opp.trail[i].r === dot.row)
              return opp.strokeColor;
          }
        }
      }

      if (user && user.territory.has(key) && !user.isDead)
        return user.fillColor;
      if (ai && ai.territory.has(key) && !ai.isDead) return ai.fillColor;
      var keys = Object.keys(opponents);
      for (var j = 0; j < keys.length; j++) {
        if (opponents[keys[j]].territory.has(key) && !opponents[keys[j]].isDead)
          return opponents[keys[j]].fillColor;
      }
      return null;
    },

    // Wave animation
    getPlayerPositions: function () {
      if (!isGameActive || !user) return [];
      var positions = [getBaseCoords(user.col, user.row)];
      if (ai) positions.push(getBaseCoords(ai.col, ai.row));
      return positions;
    },

    serialize: function () {
      if (!user) return {};
      return {
        col: user.col,
        row: user.row,
        dir: user.dir,
        nextDir: user.nextDir,
        strokeColor: user.strokeColor,
        fillColor: user.fillColor,
        trail: user.trail,
        territory: Array.from(user.territory),
        isDead: user.isDead,
        lastSafe: user.lastSafe,
      };
    },
    deserialize: function (data, isInit, networkId) {
      if (!networkId || !data) return;
      var isNewOpponent = false;
      if (!opponents[networkId]) {
        // New opponent
        var stroke = data.strokeColor || "#ff2b34";
        var fill = data.fillColor || "#990000";
        opponents[networkId] = initPlayer(
          true,
          data.col,
          data.row,
          stroke,
          fill,
          stroke,
          data.dir.x,
          data.dir.y,
        );
        if (onOpponentCountChangedCb)
          onOpponentCountChangedCb(Object.keys(opponents).length);
        isNewOpponent = true;
      }

      var opp = opponents[networkId];
      opp.strokeColor = data.strokeColor;
      opp.fillColor = data.fillColor;
      opp.headColor = data.strokeColor;

      var resurrected = false;
      if (data.isDead && !opp.isDead) {
        opp.isDead = true;
        opp.territory.clear();
        opp.trail = [];
      } else if (!data.isDead && opp.isDead) {
        opp.isDead = false;
        resurrected = true;
      }

      if (!opp.isDead) {
        opp.nextDir = data.nextDir;
        var dist = Math.abs(opp.col - data.col) + Math.abs(opp.row - data.row);
        var trailCleared = opp.trail.length > 0 && data.trail.length === 0;
        if (
          dist > 0.5 ||
          trailCleared ||
          isInit ||
          isNewOpponent ||
          resurrected
        ) {
          opp.col = data.col;
          opp.row = data.row;
          opp.dir = data.dir;
          opp.trail = data.trail;
          opp.territory = new Set(data.territory);
          opp.lastSafe = data.lastSafe;
        } else {
          opp.territory = new Set(data.territory); // Keep territory in sync
        }
      }
    },
    restart: function (isRobotOn, spawnIndex) {
      restartGame(isRobotOn, spawnIndex);
    },
    previewGame: function (isRobotOn, spawnIndex, keepOpponents) {
      spawnIndex = spawnIndex || 0;
      var spawns = [
        { c: 0, r: Math.floor(ROWS / 2), dx: 1, dy: 0 },
        { c: COLS - 1, r: Math.floor(ROWS / 2), dx: -1, dy: 0 },
        { c: Math.floor(COLS / 2), r: 0, dx: 0, dy: 1 },
        { c: Math.floor(COLS / 2), r: ROWS - 1, dx: 0, dy: -1 },
        { c: 0, r: 0, dx: 1, dy: 0 },
        { c: COLS - 1, r: 0, dx: -1, dy: 0 },
        { c: 0, r: ROWS - 1, dx: 1, dy: 0 },
        { c: COLS - 1, r: ROWS - 1, dx: -1, dy: 0 },
      ];
      var sp = spawns[spawnIndex % spawns.length];

      initAIColors();
      user = initPlayer(
        false,
        sp.c,
        sp.r,
        buddyStrokeColor,
        buddyFillColor,
        buddyStrokeColor,
        sp.dx,
        sp.dy,
      );
      if (isRobotOn) {
        var aiSp = spawns[1];
        ai = initPlayer(
          true,
          aiSp.c,
          aiSp.r,
          aiStrokeColor,
          aiFillColor,
          aiStrokeColor,
          aiSp.dx,
          aiSp.dy,
        );
      } else {
        ai = null;
      }
      if (!keepOpponents) {
        opponents = {};
        if (onOpponentCountChangedCb) onOpponentCountChangedCb(0);
      }
      isGameActive = false;
      if (broadcastUpdateCb) broadcastUpdateCb();
    },
    startGame: function (isRobotOn, spawnIndex) {
      isGameActive = true;
    },
    addOrRemoveAi: function (isRobotOn) {
      if (isRobotOn) {
        var midRow = Math.floor(ROWS / 2);
        initAIColors();
        if (!ai)
          ai = initPlayer(
            true,
            COLS - 1,
            midRow,
            aiStrokeColor,
            aiFillColor,
            aiStrokeColor,
            -1,
            0,
          );
      } else {
        ai = null;
      }
    },
    getOpponentCount: function () {
      return Object.keys(opponents).length;
    },
    removeOpponent: function (networkId) {
      if (opponents[networkId]) {
        delete opponents[networkId];
        if (onOpponentCountChangedCb)
          onOpponentCountChangedCb(Object.keys(opponents).length);
      }
    },
    setBuddyColors: function (stroke, fill) {
      buddyStrokeColor = stroke;
      buddyFillColor = fill;
      if (user) {
        user.strokeColor = buddyStrokeColor;
        user.fillColor = buddyFillColor;
        user.headColor = buddyStrokeColor;
      }
    },
  };

  return GameMode;
});
