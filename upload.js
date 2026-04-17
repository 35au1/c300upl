const dropZone    = document.getElementById('dropZone');
const dropInner   = document.getElementById('dropInner');
const previewWrap = document.getElementById('previewWrap');
const previewImg  = document.getElementById('previewImg');
const fileInput   = document.getElementById('fileInput');
const removeBtn   = document.getElementById('removeImg');
const descInput   = document.getElementById('descInput');
const codeInput   = document.getElementById('codeInput');
const submitBtn   = document.getElementById('submitBtn');
const status      = document.getElementById('status');
const pasteBtn    = document.getElementById('pasteBtn');

const MASTER_GIST_ID = 'a67bbfa0a2254bbf4f6567e3a4f94bf0';
const INDEX_FILENAME = 'gallery-index.json';

// Restore saved token from localStorage
const savedCode = localStorage.getItem('c300_upload_code');
if (savedCode) codeInput.value = savedCode;

let selectedFile = null;
let base64Data   = null;

// ── Drag & drop ──────────────────────────────────────────────
dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) loadFile(file);
});

dropZone.addEventListener('click', () => {
    if (previewWrap.style.display === 'none') fileInput.click();
});

fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) loadFile(fileInput.files[0]);
});

removeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    clearFile();
});

// ── Paste from clipboard ─────────────────────────────────────
pasteBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
            const imageType = item.types.find(t => t.startsWith('image/'));
            if (imageType) {
                const blob = await item.getType(imageType);
                const file = new File([blob], 'clipboard.' + imageType.split('/')[1], { type: imageType });
                loadFile(file);
                return;
            }
        }
        setStatus('error', '❌ No image found in clipboard.');
    } catch (err) {
        setStatus('error', '❌ Clipboard access denied. Try Ctrl+V or use Choose File.');
    }
});

// ── Ctrl+V anywhere on the page ──────────────────────────────
document.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const item of items) {
        if (item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) loadFile(file);
            return;
        }
    }
});

function loadFile(file) {
    selectedFile = file;
    const reader = new FileReader();
    reader.onload = (e) => {
        const result = e.target.result;
        base64Data = result.split(',')[1];
        previewImg.src = result;
        dropInner.style.display = 'none';
        previewWrap.style.display = 'block';
        checkReady();
    };
    reader.readAsDataURL(file);
}

function clearFile() {
    selectedFile = null;
    base64Data   = null;
    previewImg.src = '';
    fileInput.value = '';
    previewWrap.style.display = 'none';
    dropInner.style.display = 'flex';
    checkReady();
}

// ── Enable submit when image + description + code ready ──────
descInput.addEventListener('input', checkReady);
codeInput.addEventListener('input', checkReady);

function checkReady() {
    submitBtn.disabled = !(base64Data && descInput.value.trim() && codeInput.value.trim());
}

// ── Submit ────────────────────────────────────────────────────
submitBtn.addEventListener('click', uploadToGist);

async function uploadToGist() {
    const description = descInput.value.trim();
    const ext         = selectedFile.name.split('.').pop().toLowerCase();
    const filename    = slugify(description) + '.' + ext;
    const timestamp   = new Date().toISOString();

    // Get token from input
    const OWNER_TOKEN = codeInput.value.trim();
    if (!OWNER_TOKEN) {
        setStatus('error', '❌ Enter your GitHub token.');
        return;
    }

    // Save token to localStorage for next visit
    localStorage.setItem('c300_upload_code', OWNER_TOKEN);

    setStatus('loading', '⏳ Step 1/3 — Creating image Gist...');
    submitBtn.disabled = true;

    const manifest = JSON.stringify({
        description, filename,
        uploaded: timestamp,
        source: 'c300-gallery-uploader'
    }, null, 2);

    // Step 1: create image Gist
    let imageGistId;
    try {
        const res = await fetch('https://api.github.com/gists', {
            method: 'POST',
            headers: ghHeaders(OWNER_TOKEN),
            body: JSON.stringify({
                description: `c300-gallery | ${description}`,
                public: true,
                files: {
                    'gallery.json':      { content: manifest },
                    [filename + '.b64']: { content: base64Data }
                }
            })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
        imageGistId = data.id;
    } catch (err) {
        setStatus('error', `❌ Failed to create image Gist: ${err.message}`);
        checkReady();
        return;
    }

    // Step 2: read current master index
    setStatus('loading', '⏳ Step 2/3 — Reading gallery index...');
    let currentIds = [];
    try {
        const res  = await fetch(`https://api.github.com/gists/${MASTER_GIST_ID}`, { headers: ghHeaders(OWNER_TOKEN) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
        if (data.files && data.files[INDEX_FILENAME]) {
            currentIds = JSON.parse(data.files[INDEX_FILENAME].content);
        }
    } catch (err) {
        setStatus('error', `❌ Failed to read master index: ${err.message}`);
        checkReady();
        return;
    }

    // Step 3: append and save
    setStatus('loading', '⏳ Step 3/3 — Updating gallery index...');
    currentIds.push(imageGistId);
    try {
        const res = await fetch(`https://api.github.com/gists/${MASTER_GIST_ID}`, {
            method: 'PATCH',
            headers: ghHeaders(OWNER_TOKEN),
            body: JSON.stringify({
                files: { [INDEX_FILENAME]: { content: JSON.stringify(currentIds, null, 2) } }
            })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
    } catch (err) {
        setStatus('error', `❌ Image uploaded but failed to update index: ${err.message}`);
        checkReady();
        return;
    }

    setStatus('success', '✅ Done! Image added to the gallery.');
    descInput.value = '';
    clearFile();
}

// ── Helpers ───────────────────────────────────────────────────
function ghHeaders(token) {
    return {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github+json'
    };
}

function setStatus(type, html) {
    status.className = 'status ' + type;
    status.innerHTML = html;
}

function slugify(str) {
    return str
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 40) || 'image';
}
