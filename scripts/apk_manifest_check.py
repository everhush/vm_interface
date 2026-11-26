"""Read bounded signed APK manifest metadata without a native SDK binary."""
import struct
import zipfile

MAX_MANIFEST = 256 * 1024
ANDROID_NS = "http://schemas.android.com/apk/res/android"
NONE = 0xFFFFFFFF


def manifest_metadata(raw):
    if not 8 <= len(raw) <= MAX_MANIFEST:
        raise ValueError("Invalid manifest length")
    def unpack(fmt, data, off):
        if off < 0 or off + struct.calcsize(fmt) > len(data):
            raise ValueError("Truncated manifest field")
        return struct.unpack_from(fmt, data, off)
    if unpack("<HHI", raw, 0) != (3, 8, len(raw)):
        raise ValueError("Expected compiled Android XML")
    strings = None
    def string(index):
        if index == NONE:
            return None
        if strings is None or index >= len(strings):
            raise ValueError("Invalid manifest string reference")
        return strings[index]
    offset = 8
    while offset < len(raw):
        kind, header, size = unpack("<HHI", raw, offset)
        if not 8 <= header <= size or offset + size > len(raw):
            raise ValueError("Invalid manifest chunk")
        data = raw[offset:offset+size]
        if kind == 1:
            if strings is not None or header < 28:
                raise ValueError("Invalid manifest string pool")
            count, styles, flags, start, style_start = unpack("<IIIII", data, 8)
            limit = style_start or len(data)
            if count > 4096 or header + 4*(count+styles) > start or not start <= limit <= len(data):
                raise ValueError("Invalid manifest string pool bounds")
            strings = []
            for i in range(count):
                pos = start + unpack("<I", data, header+4*i)[0]
                if not start <= pos < limit:
                    raise ValueError("Invalid manifest string offset")
                def length8(at):
                    n, = unpack("<B", data, at)
                    return (((n & 127) << 8) | unpack("<B", data, at+1)[0], at+2) if n & 128 else (n, at+1)
                if flags & 0x100:
                    _, pos = length8(pos)
                    n, pos = length8(pos)
                    if pos+n >= limit or data[pos+n] != 0:
                        raise ValueError("Invalid UTF-8 string")
                    strings.append(data[pos:pos+n].decode("utf-8"))
                else:
                    n, = unpack("<H", data, pos); pos += 2
                    if n & 0x8000:
                        n = ((n & 0x7FFF) << 16) | unpack("<H", data, pos)[0]; pos += 2
                    if pos+2*n+2 > limit or data[pos+2*n:pos+2*n+2] != b"\0\0":
                        raise ValueError("Invalid UTF-16 string")
                    strings.append(data[pos:pos+2*n].decode("utf-16-le"))
        elif kind == 0x102:
            if header != 16 or strings is None:
                raise ValueError("Invalid manifest root element")
            ns, name, start, stride, count = unpack("<IIHHH", data, header)
            if string(ns) is not None or string(name) != "manifest" or start < 20 or stride != 20 or count > 128 or header+start+stride*count > size:
                raise ValueError("Invalid manifest root attributes")
            attrs = {}
            for i in range(count):
                ns, name, raw_value, value_size, reserved, value_type, value = unpack("<IIIHBBI", data, header+start+i*stride)
                key = (string(ns), string(name))
                if key in attrs or value_size != 8 or reserved != 0:
                    raise ValueError("Invalid or duplicate manifest attribute")
                attrs[key] = string(value) if value_type == 3 else value if value_type == 16 else None
                if raw_value != NONE and value_type == 3 and string(raw_value) != attrs[key]:
                    raise ValueError("Conflicting manifest attribute")
            return {"package":attrs.get((None,"package")),"versionName":attrs.get((ANDROID_NS,"versionName")),"versionCode":attrs.get((ANDROID_NS,"versionCode"))}
        offset += size
    raise ValueError("Missing compiled manifest root")


def verify_proof_apk_metadata(apk):
    with zipfile.ZipFile(apk) as archive:
        manifests = [i for i in archive.infolist() if i.filename == "AndroidManifest.xml"]
        if len(manifests) != 1 or not 8 <= manifests[0].file_size <= MAX_MANIFEST:
            raise ValueError("Missing, duplicate or oversized APK manifest")
        info = manifest_metadata(archive.read(manifests[0]))
    if info != {"package":"org.vminterface.proof","versionName":"3.0","versionCode":3}:
        raise ValueError("Unexpected signed proof APK package or version")
    return info
