export function renderMapPageHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Laboura Map</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="anonymous">
  <script src="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin="anonymous"></script>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; color: #172033; font-family: Arial, sans-serif; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 18px; background: #123c32; color: #fff; }
    header h1 { margin: 0; font-size: 20px; }
    header a { color: #fff; }
    .controls { display: flex; align-items: center; gap: 8px; padding: 10px 16px; background: #f1f5f3; }
    .controls label { font-weight: 600; }
    input, button { min-height: 36px; padding: 6px 10px; font-size: 14px; }
    button { cursor: pointer; }
    #status { padding: 8px 16px; color: #7f1d1d; }
    #map { height: calc(100vh - 112px); min-height: 420px; width: 100%; }
    #details { position: absolute; z-index: 1000; right: 16px; top: 120px; width: min(360px, calc(100vw - 32px)); max-height: 70vh; overflow: auto; padding: 14px; background: white; border: 1px solid #cbd5e1; border-radius: 8px; box-shadow: 0 4px 18px #0002; }
    #details[hidden] { display: none; }
    .legend { padding: 8px 16px; background: #fff; font-size: 13px; }
    .legend span { margin-right: 14px; }
    @media (max-width: 600px) { .controls { flex-wrap: wrap; } #map { height: calc(100vh - 160px); } }
  </style>
</head>
<body>
  <header><h1>Laboura Map</h1><button id="back" type="button">Back to console</button></header>
  <div class="controls">
    <label for="trade">Trade filter</label>
    <input id="trade" type="text" maxlength="100" placeholder="All trades">
    <button id="refresh" type="button">Refresh map</button>
    <span>Businesses remain visible for all trades.</span>
  </div>
  <div class="legend"><span>● Businesses</span><span>● Open vacancies</span><span>● Candidate area cells</span></div>
  <div id="status" role="status" aria-live="polite"></div>
  <div id="map" aria-label="Map of Laboura businesses, vacancies, and candidate areas"></div>
  <aside id="details" hidden aria-live="polite"></aside>
  <script>
    (function () {
      var token = sessionStorage.getItem('laboura_token') || '';
      var status = document.getElementById('status');
      var details = document.getElementById('details');
      var map = L.map('map').setView([12.9716, 77.5946], 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      }).addTo(map);
      var pointsLayer = L.layerGroup().addTo(map);
      var refreshTimer = null;

      function api(path) {
        return fetch(path, { headers: token ? { Authorization: 'Bearer ' + token } : {} }).then(function (response) {
          if (!response.ok) throw new Error(response.status === 403 ? 'Your role cannot view the map.' : response.status === 401 ? 'Sign in to a staff console, then open the map.' : 'The map could not be loaded.');
          return response.json();
        });
      }

      function addPopupAction(marker, title, label, action) {
        var root = document.createElement('div');
        var heading = document.createElement('strong');
        heading.textContent = title;
        root.appendChild(heading);
        var button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.style.display = 'block';
        button.style.marginTop = '8px';
        button.addEventListener('click', action);
        root.appendChild(button);
        marker.bindPopup(root);
      }

      function showDetails(title, lines) {
        details.replaceChildren();
        var heading = document.createElement('h2');
        heading.textContent = title;
        details.appendChild(heading);
        lines.forEach(function (line) {
          var row = document.createElement('p');
          row.textContent = line;
          details.appendChild(row);
        });
        var close = document.createElement('button');
        close.type = 'button';
        close.textContent = 'Close';
        close.addEventListener('click', function () { details.hidden = true; });
        details.appendChild(close);
        details.hidden = false;
      }

      function openBusiness(point) {
        api('/businesses/' + encodeURIComponent(point.id)).then(function (business) {
          showDetails(business.name || 'Business', [
            'Code: ' + (business.code || ''),
            'Verification: ' + (business.verificationStatus || 'unknown'),
            'Locality: ' + (business.locality || 'not recorded'),
            'Account agent: ' + (point.accountAgentName || 'unassigned')
          ]);
        }).catch(function (error) { status.textContent = error.message; });
      }

      function openShortlist(id) {
        api('/vacancies/' + encodeURIComponent(id) + '/shortlist').then(function (result) {
          var lines = result.matches.map(function (match) {
            return match.card.firstName + ', ' + match.card.age + ' — ' + match.card.trade + ' — ' + match.matchReasons.join(', ');
          });
          showDetails('Candidate shortlist', lines.length ? lines : ['No matching candidates.']);
        }).catch(function (error) { status.textContent = error.message; });
      }

      function loadPoints() {
        var bounds = map.getBounds();
        var bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].join(',');
        var trade = document.getElementById('trade').value.trim();
        var path = '/map/points?bbox=' + encodeURIComponent(bbox) + (trade ? '&trade=' + encodeURIComponent(trade) : '');
        status.textContent = '';
        api(path).then(function (data) {
          pointsLayer.clearLayers();
          data.businesses.forEach(function (point) {
            var marker = L.circleMarker([point.latitude, point.longitude], { radius: 7, color: '#087f5b', fillOpacity: 0.9 }).addTo(pointsLayer);
            addPopupAction(marker, point.name + ' (' + point.verificationStatus + ')', 'Open business profile', function () { openBusiness(point); });
          });
          data.vacancies.forEach(function (point) {
            var marker = L.circleMarker([point.latitude, point.longitude], { radius: 7, color: '#d97706', fillOpacity: 0.9 }).addTo(pointsLayer);
            addPopupAction(marker, (point.roleTitle || point.trade) + ' — ' + point.trade, 'Open shortlist', function () { openShortlist(point.id); });
          });
          data.candidateCells.forEach(function (cell) {
            var marker = L.circleMarker([cell.latitude, cell.longitude], { radius: Math.min(20, 5 + Math.sqrt(cell.count)), color: '#2563eb', fillOpacity: 0.55 }).addTo(pointsLayer);
            var tooltip = document.createElement('span');
            tooltip.textContent = cell.count + ' candidates · ' + cell.trades.join(', ');
            marker.bindTooltip(tooltip);
          });
        }).catch(function (error) { status.textContent = error.message; });
      }

      document.getElementById('refresh').addEventListener('click', loadPoints);
      document.getElementById('back').addEventListener('click', function () { history.back(); });
      map.on('moveend', function () {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(loadPoints, 250);
      });
      loadPoints();
    })();
  </script>
</body>
</html>`;
}
