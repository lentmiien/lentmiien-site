import requests

API_BASE = "http://192.168.0.20:8080"  # replace with your Windows machine IP

def tts(text: str, out_path: str,
        reference_id: str | None = None,
        format: str = "wav"):
    payload = {
        "text": text,
        "format": format,
        "normalize": True,
        "streaming": False,
        "chunk_length": 200,
        "max_new_tokens": 1024,
    }
    if reference_id is not None:
        payload["reference_id"] = reference_id

    r = requests.post(f"{API_BASE}/v1/tts", json=payload, stream=False)
    r.raise_for_status()
    with open(out_path, "wb") as f:
        f.write(r.content)


if __name__ == "__main__":
    # Random/default voice
    tts("(excited) Hello again from the default S1-mini voice.",
        "random_voice.wav")
