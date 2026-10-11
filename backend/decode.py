# decode.py -- decodage des payloads en clair (deja dechiffres) des
# telemetries FlatSat, d'apres la lecture de Firmware/worker.cpp.
# Reutilise uniquement des structures lues dans le code, rien d'invente.
import struct


WRAP_PERIOD = 65536 / 100.0  # 655.36 -- periode de depassement d'un int16 a l'echelle x100

def _unwrap(value, lo, hi):
    """Corrige le depassement silencieux de float_to_fixed() (worker.cpp:172,
    aucun clamp) en ajoutant/retranchant des multiples de 655.36 jusqu'a
    retomber dans une plage physiquement plausible. Marque le resultat
    comme corrige plutot que de le faire passer pour une valeur brute.
    Preuve du mecanisme : voir note 23 du vault, 997.22 - (-313.5) = 2x655.36."""
    corrected = value
    wrapped = False
    while corrected < lo:
        corrected += WRAP_PERIOD
        wrapped = True
    while corrected > hi:
        corrected -= WRAP_PERIOD
        wrapped = True
    return corrected, wrapped


def _fixed16(buf, off):
    """int16 LE / 100.0 -- float_to_fixed(val, 100.0), worker.cpp:172"""
    val = struct.unpack_from("<h", buf, off)[0]
    return val / 100.0


def decode_send_tm(plain: bytes) -> dict:
    """APID 0x008 -- telemetrySPPPackFrame, worker.cpp:872-887 (20 octets)."""
    if len(plain) < 19:
        return {}
    off = 1  # byte 0 = SPACECRAFT_ID
    accel_x = _fixed16(plain, off); off += 2
    accel_y = _fixed16(plain, off); off += 2
    accel_z = _fixed16(plain, off); off += 2
    accel_t = _fixed16(plain, off); off += 2
    bme_t = _fixed16(plain, off); off += 2
    bme_p = _fixed16(plain, off); off += 2
    bme_alt = _fixed16(plain, off); off += 2
    bme_hum = _fixed16(plain, off); off += 2
    thruster0 = plain[off] if off < len(plain) else None; off += 1
    thruster1 = plain[off] if off < len(plain) else None

    # Correction du bug de depassement (note 23, CR-018) : la pression
    # (~300-1100 hPa) et l'axe Z de l'accel (~-2200..2200 a plat/en mouvement
    # normal) sont les seuls champs dont la plage reelle depasse ce qu'un
    # int16/100 encode sans deborder.
    bme_p, p_fixed = _unwrap(bme_p, 800, 1100)
    accel_z, z_fixed = _unwrap(accel_z, -2200, 2200)

    return {
        "accel": {"x": accel_x, "y": accel_y, "z": accel_z, "temp": accel_t,
                 "z_corrected": z_fixed},
        "bme": {"temp": bme_t, "pressure": bme_p, "altitude": bme_alt,
               "humidity": bme_hum, "pressure_corrected": p_fixed},
        "thruster": {"t0": thruster0, "t1": thruster1},
    }


def decode_nav(plain: bytes) -> dict:
    """APID 0x00E -- telemetrySPPTransmitNavSnapshot, worker.cpp:1237-1265 (30 octets)."""
    if len(plain) < 30:
        return {}
    gps_status = plain[1]
    satellites = plain[2]
    lat_e7 = struct.unpack_from("<i", plain, 3)[0]
    lon_e7 = struct.unpack_from("<i", plain, 7)[0]
    alt_cm = struct.unpack_from("<i", plain, 11)[0]
    utc_hour, utc_min, utc_sec, utc_day, utc_month = plain[15:20]
    utc_year = struct.unpack_from("<H", plain, 20)[0]
    accel_x = _fixed16(plain, 22)
    accel_y = _fixed16(plain, 24)
    accel_z = _fixed16(plain, 26)
    accel_t = _fixed16(plain, 28)
    has_fix = satellites > 0
    return {
        "gps_status": gps_status,
        "satellites": satellites,
        "has_fix": has_fix,
        "lat": lat_e7 / 1e7 if has_fix else None,
        "lon": lon_e7 / 1e7 if has_fix else None,
        "alt_m": alt_cm / 100.0 if has_fix else None,
        "utc": f"{utc_year:04d}-{utc_month:02d}-{utc_day:02d} "
               f"{utc_hour:02d}:{utc_min:02d}:{utc_sec:02d}",
        "accel": {"x": accel_x, "y": accel_y, "z": accel_z, "temp": accel_t},
    }


def decode_status(plain: bytes) -> dict:
    """APID 0x00C -- telemetrySPPTransmitMissionStatus (26 octets, voir note 18)."""
    if len(plain) < 26:
        return {}
    mode = plain[1]
    flags = plain[2]
    gps_status = plain[3]
    beacon_s = plain[4]
    t0, t1 = plain[5], plain[6]
    sats = plain[7]
    uptime_s = struct.unpack_from("<I", plain, 12)[0]
    fw = f"{plain[25]}.{plain[24]}.{plain[23]}"
    return {
        "mode": mode, "flags": flags, "gps_status": gps_status,
        "beacon_s": beacon_s, "thruster": {"t0": t0, "t1": t1},
        "satellites": sats, "uptime_s": uptime_s, "firmware": fw,
    }


DECODERS = {0x008: decode_send_tm, 0x00E: decode_nav, 0x00C: decode_status}
