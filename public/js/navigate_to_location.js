/*************************************************************
 * 1) SET YOUR TARGET LOCATION HERE                          *
 *************************************************************/
const target = {
  lat: parseFloat(document.getElementById('longitude').innerHTML),
  lon: parseFloat(document.getElementById('latitude').innerHTML)
};

/*************************************************************
 * Global storage for user location & heading               *
 *************************************************************/
let userLat = null;
let userLon = null;
let userHeading = null;  // degrees, 0 = North

/*************************************************************
 * Some helpful utilities: distance & bearing calculations   *
 * (Haversine formula + initial bearing)                    *
 *************************************************************/
function toRadians(angleInDegrees) {
  return angleInDegrees * Math.PI / 180;
}

/**
 * Compute the distance between two lat/lon points in meters
 * Haversine formula
 */
function computeDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Radius of the Earth in meters
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const deltaPhi = toRadians(lat2 - lat1);
  const deltaLambda = toRadians(lon2 - lon1);

  const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Calculate the initial bearing from (lat1, lon1) to (lat2, lon2)
 * Returns bearing in degrees, 0° = north, heading eastward
 */
function computeBearing(lat1, lon1, lat2, lon2) {
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const lambda1 = toRadians(lon1);
  const lambda2 = toRadians(lon2);

  const y = Math.sin(lambda2 - lambda1) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) -
            Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda2 - lambda1);

  let theta = Math.atan2(y, x);
  // Convert from radians to degrees
  theta = theta * (180 / Math.PI);
  // Normalize bearing to 0-360
  return (theta + 360) % 360;
}

/*************************************************************
 * Main Render function: draws on the canvas                 *
 *************************************************************/
function drawCompass() {
  document.getElementById("time").innerText = new Date();
  
  const canvas = document.getElementById("compassCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;

  // Clear the canvas
  ctx.clearRect(0, 0, width, height);

  // Center point
  const centerX = width / 2;
  const centerY = height / 2;
  // Choose a radius for the circle
  const radius = Math.min(centerX, centerY) - 20; 

  // Draw center dot (current user location)
  ctx.fillStyle = "blue";
  ctx.beginPath();
  ctx.arc(centerX, centerY, 5, 0, 2 * Math.PI);
  ctx.fill();

  // If we don't have user location or target, we can't proceed.
  if (userLat === null || userLon === null) {
    return;
  }

  // Compute the distance
  const dist = computeDistance(userLat, userLon, target.lat, target.lon);
  // Display the distance in some convenient unit
  const distanceElem = document.getElementById("distanceLabel");
  if (distanceElem) {
    distanceElem.innerText =
      "Distance: " + (dist >= 1000
        ? (dist / 1000).toFixed(2) + " km"
        : dist.toFixed(1) + " m");
  }

  // Draw the second dot representing the target direction
  // If we have a valid compass reading:
  let bearingToTarget = computeBearing(userLat, userLon, target.lat, target.lon);
  let angleToTarget;
  if (userHeading !== null) {
    // Bearing relative to device heading
    // device heading is 0 = north, increasing clockwise
    // bearingToTarget is also 0 = north, increasing clockwise
    // So angle we need is bearingToTarget - userHeading in degrees
    angleToTarget = bearingToTarget - userHeading;
  } else {
    // If compass data is unavailable, just put the target dot at the "top" (north)
    angleToTarget = 0;
  }

  // Convert angle in degrees to radians & shift so 0 = up
  const angleRadians = toRadians(angleToTarget);

  // Find the x,y offset for the second dot
  const targetX = centerX + radius * Math.sin(angleRadians);
  const targetY = centerY - radius * Math.cos(angleRadians);

  // Draw the target dot
  ctx.fillStyle = "red";
  ctx.beginPath();
  ctx.arc(targetX, targetY, 5, 0, 2 * Math.PI);
  ctx.fill();

  // (Optional) Label in-between the dots
  // Pick a midpoint between the center and the target dot
  const midX = (centerX + targetX) / 2;
  const midY = (centerY + targetY) / 2;
  ctx.fillStyle = "black";
  ctx.font = "16px sans-serif";
  ctx.textAlign = "center";
  // Display the distance without the "Distance: " prefix
  ctx.fillText(distanceElem.innerText.replace("Distance: ", ""), midX, midY);
}

/*************************************************************
 * Geolocation: get user's position                          *
 *************************************************************/
function onPositionUpdate(position) {
  userLat = position.coords.latitude;
  userLon = position.coords.longitude;
  // drawCompass(); // Removed to update once per second

  document.getElementById('la').innerText = position.coords.latitude;
  document.getElementById('lo').innerText = position.coords.longitude;
}

function onPositionError(err) {
  console.error("Geolocation error:", err);
  document.getElementById("status").innerText =
    "Error getting location. " + (err.message || "");
}

/*************************************************************
 * Device Orientation (compass)                              *
 *************************************************************/
function onDeviceOrientation(event) {
  // event.alpha is the compass heading in degrees (0=North, but may differ by browser)
  // Some browsers require "absolute" orientation. 
  if (event.absolute === true || event.absolute === undefined) {
    if (event.alpha !== null) {
      // event.alpha: 0 = pointing north, range 0-360
      userHeading = event.alpha;
      // drawCompass(); // Removed to update once per second
    }
  }
}

/*************************************************************
 * Initialization / watchers                                 *
 *************************************************************/
function initApp() {
  // Watch for location changes
  if ("geolocation" in navigator) {
    navigator.geolocation.watchPosition(
      onPositionUpdate, 
      onPositionError,
      { enableHighAccuracy: true, maximumAge: 0 }
    );
  } else {
    document.getElementById("status").innerText =
      "Geolocation not supported on this device.";
  }

  // Listen for device orientation to get compass heading
  if (window.DeviceOrientationEvent) {
    // Some modern browsers require a permission request for iOS 13+:
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      // For iOS only
      DeviceOrientationEvent.requestPermission()
        .then((response) => {
          if (response === 'granted') {
            window.addEventListener('deviceorientation', onDeviceOrientation, true);
          } else {
            // Fallback: If compass not accessible, we place the target at the top
            document.getElementById("status").innerText =
              "Compass access denied. Target arrow will always point north.";
          }
        })
        .catch(console.error);
    } else {
      // Non-iOS devices
      window.addEventListener('deviceorientation', onDeviceOrientation, true);
    }
  } else {
    document.getElementById("status").innerText =
      "DeviceOrientation not supported. Target arrow will always point north.";
  }

  // Update the canvas once per second
  setInterval(drawCompass, 1000);
}

// Start everything
window.addEventListener("load", initApp);
