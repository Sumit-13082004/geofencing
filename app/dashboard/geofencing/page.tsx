"use client";

import { useEffect, useRef, useState, useCallback } from "react";

// Types
interface Coordinate {
    lat: number;
    lng: number;
}

interface GeofenceZone {
    id: string;
    name: string;
    coordinates: Coordinate[];
    area: number; // in sq meters
    createdAt: Date;
    color: string;
}

const ZONE_COLORS = [
    "#4ade80", "#facc15", "#60a5fa", "#f87171",
    "#a78bfa", "#fb923c", "#34d399", "#e879f9",
];

export default function GeofencingPage() {
    const mapRef = useRef<HTMLDivElement>(null);
    const mapInstanceRef = useRef<any>(null);
    const [isLocating, setIsLocating] = useState(false);
    const [locationGranted, setLocationGranted] = useState(false);
    const [zones, setZones] = useState<GeofenceZone[]>([]);
    const [pendingCoords, setPendingCoords] = useState<Coordinate[] | null>(null);
    const [pendingLayer, setPendingLayer] = useState<any>(null);
    const [zoneName, setZoneName] = useState("");
    const [showNamingModal, setShowNamingModal] = useState(false);
    const [activeZoneId, setActiveZoneId] = useState<string | null>(null);
    const [mapReady, setMapReady] = useState(false);
    const [toast, setToast] = useState<{ msg: string; type: "success" | "error" | "info" } | null>(null);
    const layerMapRef = useRef<Map<string, any>>(new Map());
    const colorIndexRef = useRef(0);

    const showToast = (msg: string, type: "success" | "error" | "info" = "info") => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 3000);
    };

    // Compute polygon area via Shoelace
    const computeArea = (coords: Coordinate[]): number => {
        if (coords.length < 3) return 0;
        const R = 6371000;
        let area = 0;
        const n = coords.length;
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            const xi = (coords[i].lng * Math.PI) / 180;
            const yi = (coords[i].lat * Math.PI) / 180;
            const xj = (coords[j].lng * Math.PI) / 180;
            const yj = (coords[j].lat * Math.PI) / 180;
            area += xi * Math.sin(yj) - xj * Math.sin(yi);
        }
        return Math.abs((area * R * R) / 2);
    };

    const formatArea = (sqm: number): string => {
        if (sqm >= 10000) return `${(sqm / 10000).toFixed(2)} ha`;
        return `${sqm.toFixed(0)} m²`;
    };

    // Initialize map
    const initMap = useCallback((lat: number, lng: number) => {
        if (mapInstanceRef.current || !mapRef.current) return;

        const L = (window as any).L;
        const map = L.map(mapRef.current, {
            zoomControl: false,
            attributionControl: false,
        }).setView([lat, lng], 17);

        // Satellite layer
        L.tileLayer(
            "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            { maxZoom: 20 }
        ).addTo(map);

        // Subtle label overlay
        L.tileLayer(
            "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
            { maxZoom: 20, opacity: 0.6 }
        ).addTo(map);

        // Custom zoom controls
        L.control.zoom({ position: "bottomright" }).addTo(map);

        // Attribution minimal
        L.control.attribution({ position: "bottomleft", prefix: false })
            .addAttribution("© Esri · © OSM")
            .addTo(map);

        // Geoman toolbar
        map.pm.addControls({
            position: "topleft",
            drawMarker: false,
            drawCircleMarker: false,
            drawPolyline: false,
            drawPolygon: true,
            drawCircle: false,
            drawText: false,
            drawRectangle: true,
            editMode: true,
            dragMode: true,
            cutPolygon: false,
            removalMode: true,
        });

        // Style geoman toolbar via CSS injection
        const style = document.createElement("style");
        style.textContent = `
      .leaflet-pm-toolbar .leaflet-pm-icon-marker { display: none; }
      .button-container button {
        background: rgba(10, 20, 10, 0.85) !important;
        border: 1px solid rgba(74, 222, 128, 0.3) !important;
        border-radius: 6px !important;
        color: #4ade80 !important;
        transition: all 0.2s !important;
      }
      .button-container button:hover, .button-container button.active {
        background: rgba(74, 222, 128, 0.15) !important;
        border-color: #4ade80 !important;
      }
      .leaflet-pm-toolbar { gap: 4px !important; }
    `;
        document.head.appendChild(style);

        // pm:create event
        map.on("pm:create", (e: any) => {
            const layer = e.layer;
            const geoJSON = layer.toGeoJSON();
            const rawCoords: [number, number][] = geoJSON.geometry.coordinates[0];

            const coords: Coordinate[] = rawCoords.map(([lng, lat]) => ({
                lat: parseFloat(lat.toFixed(7)),
                lng: parseFloat(lng.toFixed(7)),
            }));

            // Remove last duplicate coord (GeoJSON closes the ring)
            if (
                coords.length > 1 &&
                coords[0].lat === coords[coords.length - 1].lat &&
                coords[0].lng === coords[coords.length - 1].lng
            ) {
                coords.pop();
            }

            setPendingCoords(coords);
            setPendingLayer(layer);
            setZoneName(`Zone ${Date.now().toString().slice(-4)}`);
            setShowNamingModal(true);

            // Temporarily hide layer until confirmed
            layer.setStyle({ opacity: 0.5, fillOpacity: 0.1 });
        });

        mapInstanceRef.current = map;
        setMapReady(true);
    }, []);

    // Load Leaflet scripts dynamically
    useEffect(() => {
        const loadScripts = async () => {
            if ((window as any).L) return;

            const leafletCSS = document.createElement("link");
            leafletCSS.rel = "stylesheet";
            leafletCSS.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
            document.head.appendChild(leafletCSS);

            const geomanCSS = document.createElement("link");
            geomanCSS.rel = "stylesheet";
            geomanCSS.href =
                "https://unpkg.com/@geoman-io/leaflet-geoman-free@latest/dist/leaflet-geoman.css";
            document.head.appendChild(geomanCSS);

            await new Promise<void>((resolve) => {
                const script = document.createElement("script");
                script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
                script.onload = () => resolve();
                document.head.appendChild(script);
            });

            await new Promise<void>((resolve) => {
                const script = document.createElement("script");
                script.src =
                    "https://unpkg.com/@geoman-io/leaflet-geoman-free@latest/dist/leaflet-geoman.min.js";
                script.onload = () => resolve();
                document.head.appendChild(script);
            });
        };

        loadScripts();
    }, []);

    // Auto-locate on mount
    useEffect(() => {
        if (!mapRef.current) return;

        const tryLocate = () => {
            setIsLocating(true);
            if (!navigator.geolocation) {
                initMap(22.6534, 88.4065);
                setIsLocating(false);
                showToast("Geolocation not supported. Using default location.", "error");
                return;
            }
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    setLocationGranted(true);
                    setIsLocating(false);
                    initMap(pos.coords.latitude, pos.coords.longitude);
                    showToast("Location acquired!", "success");
                },
                () => {
                    setIsLocating(false);
                    initMap(22.6534, 88.4065);
                    showToast("Location denied. Using default area.", "error");
                },
                { enableHighAccuracy: true, timeout: 8000 }
            );
        };

        // Wait for Leaflet to load
        const interval = setInterval(() => {
            if ((window as any).L && (window as any).L.PM) {
                clearInterval(interval);
                tryLocate();
            }
        }, 200);

        return () => clearInterval(interval);
    }, [initMap]);

    const handleSaveZone = () => {
        if (!pendingCoords || !pendingLayer || !zoneName.trim()) return;

        const color = ZONE_COLORS[colorIndexRef.current % ZONE_COLORS.length];
        colorIndexRef.current++;

        const newZone: GeofenceZone = {
            id: crypto.randomUUID(),
            name: zoneName.trim(),
            coordinates: pendingCoords,
            area: computeArea(pendingCoords),
            createdAt: new Date(),
            color,
        };

        // Style the confirmed layer
        pendingLayer.setStyle({
            color,
            fillColor: color,
            fillOpacity: 0.18,
            weight: 2,
            opacity: 0.9,
        });

        // Add a label marker
        const L = (window as any).L;
        const bounds = pendingLayer.getBounds();
        const center = bounds.getCenter();
        const label = L.marker(center, {
            icon: L.divIcon({
                html: `<div style="
          background:rgba(10,20,10,0.85);
          border:1px solid ${color};
          color:${color};
          padding:3px 8px;
          border-radius:4px;
          font-size:11px;
          font-family:'DM Mono',monospace;
          white-space:nowrap;
          pointer-events:none;
        ">${zoneName.trim()}</div>`,
                className: "",
                iconAnchor: [0, 0],
            }),
            interactive: false,
        }).addTo(mapInstanceRef.current);

        layerMapRef.current.set(newZone.id, { shape: pendingLayer, label });

        setZones((prev) => [...prev, newZone]);
        setShowNamingModal(false);
        setPendingCoords(null);
        setPendingLayer(null);
        setZoneName("");
        showToast(`Zone "${newZone.name}" saved!`, "success");
    };

    const handleCancelZone = () => {
        if (pendingLayer && mapInstanceRef.current) {
            mapInstanceRef.current.removeLayer(pendingLayer);
        }
        setShowNamingModal(false);
        setPendingCoords(null);
        setPendingLayer(null);
        setZoneName("");
    };

    const handleDeleteZone = (id: string) => {
        const layers = layerMapRef.current.get(id);
        if (layers && mapInstanceRef.current) {
            mapInstanceRef.current.removeLayer(layers.shape);
            mapInstanceRef.current.removeLayer(layers.label);
            layerMapRef.current.delete(id);
        }
        setZones((prev) => prev.filter((z) => z.id !== id));
        if (activeZoneId === id) setActiveZoneId(null);
        showToast("Zone removed.", "info");
    };

    const handleFlyToZone = (zone: GeofenceZone) => {
        const layers = layerMapRef.current.get(zone.id);
        if (layers && mapInstanceRef.current) {
            mapInstanceRef.current.flyToBounds(layers.shape.getBounds(), { padding: [60, 60], duration: 1 });
            setActiveZoneId(zone.id);
        }
    };

    const handleExport = () => {
        const data = zones.map((z) => ({
            name: z.name,
            area: formatArea(z.area),
            coordinates: z.coordinates,
        }));
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "agrosense-geofences.json";
        a.click();
        URL.revokeObjectURL(url);
        showToast("Exported geofences.json", "success");
    };

    return (
        <div
            style={{
                minHeight: "100vh",
                background: "#060d06",
                fontFamily: "'DM Mono', 'Courier New', monospace",
                color: "#d1fae5",
                display: "flex",
                flexDirection: "column",
            }}
        >
            {/* Google Font */}
            <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@400;600;700;800&display=swap');

        * { box-sizing: border-box; margin: 0; padding: 0; }

        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #0a140a; }
        ::-webkit-scrollbar-thumb { background: #4ade8055; border-radius: 4px; }

        .zone-card {
          background: rgba(10, 20, 10, 0.7);
          border: 1px solid rgba(74, 222, 128, 0.15);
          border-radius: 8px;
          padding: 12px 14px;
          cursor: pointer;
          transition: all 0.2s;
          position: relative;
          overflow: hidden;
        }
        .zone-card::before {
          content: '';
          position: absolute;
          left: 0; top: 0; bottom: 0;
          width: 3px;
          background: var(--zone-color, #4ade80);
          border-radius: 3px 0 0 3px;
        }
        .zone-card:hover, .zone-card.active {
          background: rgba(74, 222, 128, 0.06);
          border-color: rgba(74, 222, 128, 0.35);
        }
        .btn-primary {
          background: #4ade80;
          color: #020c02;
          border: none;
          border-radius: 6px;
          padding: 9px 18px;
          font-family: 'DM Mono', monospace;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
          letter-spacing: 0.05em;
        }
        .btn-primary:hover { background: #86efac; transform: translateY(-1px); }
        .btn-ghost {
          background: transparent;
          color: #6b7280;
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 6px;
          padding: 8px 16px;
          font-family: 'DM Mono', monospace;
          font-size: 11px;
          cursor: pointer;
          transition: all 0.2s;
          letter-spacing: 0.05em;
        }
        .btn-ghost:hover { color: #d1fae5; border-color: rgba(255,255,255,0.25); }
        .btn-danger {
          background: transparent;
          color: #f87171;
          border: 1px solid rgba(248,113,113,0.2);
          border-radius: 5px;
          padding: 4px 8px;
          font-size: 10px;
          font-family: 'DM Mono', monospace;
          cursor: pointer;
          transition: all 0.2s;
        }
        .btn-danger:hover { background: rgba(248,113,113,0.1); }
        .modal-overlay {
          position: fixed; inset: 0;
          background: rgba(0,0,0,0.6);
          backdrop-filter: blur(4px);
          z-index: 9999;
          display: flex; align-items: center; justify-content: center;
          animation: fadeIn 0.15s ease;
        }
        .modal {
          background: #0d1f0d;
          border: 1px solid rgba(74, 222, 128, 0.3);
          border-radius: 12px;
          padding: 28px;
          width: 380px;
          box-shadow: 0 0 60px rgba(74, 222, 128, 0.08);
          animation: slideUp 0.2s ease;
        }
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideUp { from { transform: translateY(12px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }

        .toast {
          position: fixed; bottom: 28px; right: 28px;
          background: #0d1f0d;
          border: 1px solid rgba(74, 222, 128, 0.3);
          border-radius: 8px;
          padding: 12px 18px;
          font-size: 12px;
          z-index: 99999;
          animation: slideUp 0.2s ease;
          max-width: 280px;
        }
        .toast.success { border-color: rgba(74, 222, 128, 0.5); color: #4ade80; }
        .toast.error { border-color: rgba(248, 113, 113, 0.4); color: #f87171; }
        .toast.info { border-color: rgba(96, 165, 250, 0.4); color: #93c5fd; }

        input[type="text"] {
          width: 100%;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(74, 222, 128, 0.2);
          border-radius: 6px;
          padding: 10px 12px;
          color: #d1fae5;
          font-family: 'DM Mono', monospace;
          font-size: 13px;
          outline: none;
          transition: border-color 0.2s;
        }
        input[type="text"]:focus { border-color: #4ade80; }

        .pulse-dot {
          width: 8px; height: 8px;
          background: #4ade80;
          border-radius: 50%;
          display: inline-block;
          animation: pulse 1.5s infinite;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.7); }
        }

        .grid-bg {
          background-image:
            linear-gradient(rgba(74,222,128,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(74,222,128,0.04) 1px, transparent 1px);
          background-size: 32px 32px;
        }
      `}</style>

            {/* Top Header */}
            <header
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "16px 28px",
                    borderBottom: "1px solid rgba(74,222,128,0.1)",
                    background: "rgba(6,13,6,0.95)",
                    backdropFilter: "blur(12px)",
                    position: "sticky",
                    top: 0,
                    zIndex: 100,
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    {/* Logo mark */}
                    <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                        <rect width="32" height="32" rx="8" fill="rgba(74,222,128,0.12)" />
                        <path d="M8 22 L16 8 L24 22 Z" stroke="#4ade80" strokeWidth="1.5" fill="none" />
                        <circle cx="16" cy="17" r="3" fill="#4ade80" />
                    </svg>
                    <div>
                        <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 17, letterSpacing: "-0.02em", color: "#ecfdf5" }}>
                            AGRO<span style={{ color: "#4ade80" }}>·</span>SENSE
                        </div>
                        <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.12em" }}>GEOFENCING MODULE</div>
                    </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    {locationGranted && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#4ade80" }}>
                            <span className="pulse-dot" />
                            GPS LOCKED
                        </div>
                    )}
                    {zones.length > 0 && (
                        <button className="btn-ghost" onClick={handleExport}>
                            ↓ Export JSON
                        </button>
                    )}
                </div>
            </header>

            {/* Main Content */}
            <div style={{ display: "flex", flex: 1, overflow: "hidden", height: "calc(100vh - 65px)" }}>

                {/* Left Sidebar */}
                <aside
                    className="grid-bg"
                    style={{
                        width: 280,
                        flexShrink: 0,
                        borderRight: "1px solid rgba(74,222,128,0.1)",
                        display: "flex",
                        flexDirection: "column",
                        overflowY: "auto",
                        background: "rgba(6,13,6,0.9)",
                    }}
                >
                    {/* Sidebar Header */}
                    <div style={{ padding: "20px 18px 14px", borderBottom: "1px solid rgba(74,222,128,0.08)" }}>
                        <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 13, color: "#4ade80", letterSpacing: "0.08em", marginBottom: 4 }}>
                            GEOFENCE ZONES
                        </div>
                        <div style={{ fontSize: 10, color: "#6b7280" }}>
                            {zones.length} zone{zones.length !== 1 ? "s" : ""} defined
                        </div>
                    </div>

                    {/* Instructions */}
                    {!mapReady && (
                        <div style={{ padding: "16px 18px", fontSize: 11, color: "#4b5563", lineHeight: 1.7 }}>
                            <div style={{ color: "#4ade80", marginBottom: 6, fontWeight: 500 }}>Loading map…</div>
                            Acquiring your GPS coordinates to center the satellite view.
                        </div>
                    )}

                    {mapReady && zones.length === 0 && (
                        <div style={{ padding: "16px 18px", fontSize: 11, color: "#4b5563", lineHeight: 1.8 }}>
                            <div style={{ color: "#86efac", marginBottom: 8, fontWeight: 500, fontSize: 12 }}>
                                HOW TO USE
                            </div>
                            <div>① Select <span style={{ color: "#d1fae5" }}>Rectangle</span> or <span style={{ color: "#d1fae5" }}>Polygon</span> tool from the map toolbar</div>
                            <br />
                            <div>② Draw your crop field boundary on the satellite map</div>
                            <br />
                            <div>③ Name the zone and click <span style={{ color: "#4ade80" }}>Save Zone</span></div>
                            <br />
                            <div>④ Repeat for multiple fields or export as JSON</div>
                        </div>
                    )}

                    {/* Zone List */}
                    <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
                        {zones.map((zone) => (
                            <div
                                key={zone.id}
                                className={`zone-card ${activeZoneId === zone.id ? "active" : ""}`}
                                style={{ "--zone-color": zone.color } as any}
                                onClick={() => handleFlyToZone(zone)}
                            >
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                                    <div>
                                        <div style={{ fontSize: 13, fontWeight: 500, color: "#ecfdf5", marginBottom: 4 }}>
                                            {zone.name}
                                        </div>
                                        <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 6 }}>
                                            {zone.coordinates.length} vertices · {formatArea(zone.area)}
                                        </div>
                                        <div style={{ fontSize: 9, color: "#374151", letterSpacing: "0.04em" }}>
                                            {zone.coordinates[0].lat.toFixed(5)}, {zone.coordinates[0].lng.toFixed(5)}
                                        </div>
                                    </div>
                                    <button
                                        className="btn-danger"
                                        onClick={(e) => { e.stopPropagation(); handleDeleteZone(zone.id); }}
                                    >
                                        ✕
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </aside>

                {/* Map Area */}
                <div style={{ flex: 1, position: "relative" }}>
                    {/* Loading Overlay */}
                    {isLocating && (
                        <div
                            style={{
                                position: "absolute",
                                inset: 0,
                                background: "rgba(6,13,6,0.9)",
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                justifyContent: "center",
                                zIndex: 500,
                                gap: 16,
                            }}
                        >
                            <svg width="48" height="48" viewBox="0 0 48 48" style={{ animation: "spin 2s linear infinite" }}>
                                <style>{`@keyframes spin { to { transform: rotate(360deg) }}`}</style>
                                <circle cx="24" cy="24" r="20" stroke="rgba(74,222,128,0.2)" strokeWidth="2" fill="none" />
                                <path d="M 24 4 A 20 20 0 0 1 44 24" stroke="#4ade80" strokeWidth="2" fill="none" strokeLinecap="round" />
                            </svg>
                            <div style={{ textAlign: "center" }}>
                                <div style={{ color: "#4ade80", fontSize: 13, letterSpacing: "0.1em", fontFamily: "'Syne', sans-serif", fontWeight: 600 }}>
                                    ACQUIRING GPS
                                </div>
                                <div style={{ color: "#4b5563", fontSize: 11, marginTop: 4 }}>
                                    Allow location access to center the map on your farm
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Map Container */}
                    <div ref={mapRef} style={{ width: "100%", height: "100%" }} />

                    {/* Map Watermark */}
                    <div
                        style={{
                            position: "absolute",
                            top: 12,
                            right: 12,
                            background: "rgba(6,13,6,0.75)",
                            border: "1px solid rgba(74,222,128,0.15)",
                            borderRadius: 6,
                            padding: "6px 10px",
                            fontSize: 10,
                            color: "#4b5563",
                            letterSpacing: "0.06em",
                            pointerEvents: "none",
                            backdropFilter: "blur(4px)",
                        }}
                    >
                        SATELLITE VIEW · ESRI
                    </div>

                    {/* Zone count badge */}
                    {zones.length > 0 && (
                        <div
                            style={{
                                position: "absolute",
                                bottom: 48,
                                right: 12,
                                background: "rgba(6,13,6,0.85)",
                                border: "1px solid rgba(74,222,128,0.25)",
                                borderRadius: 6,
                                padding: "6px 12px",
                                fontSize: 11,
                                color: "#4ade80",
                                backdropFilter: "blur(4px)",
                                pointerEvents: "none",
                            }}
                        >
                            {zones.length} ZONE{zones.length !== 1 ? "S" : ""}
                        </div>
                    )}
                </div>
            </div>

            {/* Naming Modal */}
            {showNamingModal && (
                <div className="modal-overlay">
                    <div className="modal">
                        <div
                            style={{
                                fontFamily: "'Syne', sans-serif",
                                fontWeight: 700,
                                fontSize: 16,
                                color: "#ecfdf5",
                                marginBottom: 6,
                            }}
                        >
                            Name This Zone
                        </div>
                        <div style={{ fontSize: 11, color: "#4b5563", marginBottom: 20 }}>
                            {pendingCoords?.length} vertices · ~{pendingCoords ? formatArea(computeArea(pendingCoords)) : "–"}
                        </div>

                        {/* Coord preview */}
                        <div
                            style={{
                                background: "rgba(0,0,0,0.3)",
                                border: "1px solid rgba(74,222,128,0.1)",
                                borderRadius: 6,
                                padding: "10px 12px",
                                marginBottom: 16,
                                maxHeight: 110,
                                overflowY: "auto",
                            }}
                        >
                            {pendingCoords?.map((c, i) => (
                                <div key={i} style={{ fontSize: 10, color: "#4b5563", fontFamily: "'DM Mono', monospace", lineHeight: 1.8 }}>
                                    [{i + 1}] {c.lat.toFixed(6)}, {c.lng.toFixed(6)}
                                </div>
                            ))}
                        </div>

                        <div style={{ marginBottom: 18 }}>
                            <label style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.08em", display: "block", marginBottom: 6 }}>
                                ZONE NAME
                            </label>
                            <input
                                type="text"
                                value={zoneName}
                                onChange={(e) => setZoneName(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && handleSaveZone()}
                                autoFocus
                                placeholder="e.g. North Paddy Field"
                            />
                        </div>

                        <div style={{ display: "flex", gap: 10 }}>
                            <button className="btn-primary" onClick={handleSaveZone} style={{ flex: 1 }}>
                                Save Zone
                            </button>
                            <button className="btn-ghost" onClick={handleCancelZone}>
                                Discard
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Toast */}
            {toast && (
                <div className={`toast ${toast.type}`}>
                    {toast.msg}
                </div>
            )}
        </div>
    );
}