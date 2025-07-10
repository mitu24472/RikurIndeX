import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, onSnapshot, writeBatch, updateDoc, arrayUnion, arrayRemove, deleteField } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

/* --- あなたの情報を入力してください --- */

// 1. Firebaseプロジェクトの設定情報をここに貼り付け
const firebaseConfig = {
  apiKey: "AIzaSyDkgSR2WXVMbghkUkBp2xT3gmXndUW70bQ",
  authDomain: "handout-manager.firebaseapp.com",
  projectId: "handout-manager",
  storageBucket: "handout-manager.firebasestorage.app",
  messagingSenderId: "485386568974",
  appId: "1:485386568974:web:488e1a88f9ed6ecea7c35f",
  measurementId: "G-LNYDWJZGZL"
};

// 2. Cloudinaryの情報をここに貼り付け
const CLOUDINARY_CLOUD_NAME = "dgnloysyh";
const CLOUDINARY_UPLOAD_PRESET = "cvw7nkty";

/* --- ここまで --- */


const CATEGORIES = ['1年生', '2年生', '3年生', '4年生', '5年生', '6年生', '部活動'];
const INITIAL_GROUP_IDS = ['A', 'B', 'C', 'D'];
const STATUS = { COLLECTED: 'collected', UNCOLLECTED: 'uncollected', NOT_REQUIRED: 'not_required', NOT_APPLICABLE: 'na' };
const EMOJI_MAP = { [STATUS.COLLECTED]: '✅', [STATUS.UNCOLLECTED]: '🟡', [STATUS.NOT_REQUIRED]: '🚫' };
const COLLECTION_NAME = 'handouts_data'; 

const $ = (selector) => document.querySelector(selector);
let db, auth;
let unsubscribe;
let selectedCategory = '1年生';
let currentCategoryData = null;
let activeModalTarget = {};
let isAppReady = false;

const showLoader = (message = '') => {
    $('#loader-container').style.display = 'flex';
    $('#loader-message').textContent = message;
};
const hideLoader = () => {
    $('#loader-container').style.display = 'none';
    $('#loader-message').textContent = '';
};

const getInitialData = (category) => {
    const isLowGrade = ['1年生', '2年生'].includes(category);
    const isClub = category === '部活動';
    const materials = ['すのこ', '暗幕', 'ドア'];
    const groups = {};
    INITIAL_GROUP_IDS.forEach((id, index) => {
        const groupId = crypto.randomUUID();
        groups[groupId] = {
            id: groupId, order: index, name: isClub ? `グループ${id}` : `${id}組`,
            items: {}
        };
        materials.forEach(m => {
            groups[groupId].items[m] = {
                status: (m === 'すのこ' || m === 'ドア') && isLowGrade ? STATUS.NOT_APPLICABLE : STATUS.UNCOLLECTED,
                message: '', imageUrl: '', timestamp: '', updatedBy: ''
            };
        });
    });
    return { materials, groups };
};

const initializeFirestoreData = async () => {
    showLoader('データを初期化中...');
    try {
        const batch = writeBatch(db);
        for (const category of CATEGORIES) {
            const docRef = doc(db, COLLECTION_NAME, category);
            batch.set(docRef, getInitialData(category));
        }
        await batch.commit();
    } catch (error) { console.error("Error initializing data: ", error); }
};

const renderCategorySelectors = () => {
    $('#category-selector').innerHTML = CATEGORIES.map(c => `<button data-category="${c}" class="category-tab py-2 px-5 rounded-full text-sm sm:text-base font-medium text-slate-600 hover:bg-slate-200">${c}</button>`).join('');
    $(`button[data-category="${selectedCategory}"]`).classList.add('active');
};

const calculateProgress = (groupItems, materials) => {
    const applicableItems = materials.filter(m => groupItems[m]?.status !== STATUS.NOT_APPLICABLE);
    if (applicableItems.length === 0) return { percent: 0, completed: 0, total: 0 };
    const completedCount = applicableItems.filter(m => groupItems[m]?.status === STATUS.COLLECTED || groupItems[m]?.status === STATUS.NOT_REQUIRED).length;
    const percent = Math.round((completedCount / applicableItems.length) * 100);
    return { percent, completed: completedCount, total: applicableItems.length };
};

const renderHeader = (materials) => {
    const headerRow = `<tr><th class="p-4 font-semibold text-slate-600 text-left text-sm tracking-wider">グループ</th>${materials.map(m => `<th class="p-4 font-semibold text-slate-600 text-sm tracking-wider">${m} <button data-item-name="${m}" class="delete-item-btn text-red-400 hover:text-red-600 ml-1">×</button></th>`).join('')}<th class="p-4 font-semibold text-slate-600 text-sm tracking-wider text-left">完了率</th></tr>`;
    $('#table-header').innerHTML = headerRow;
};

const renderBody = (categoryData) => {
    if (!categoryData || !categoryData.materials || !categoryData.groups) {
        $('#status-table-body').innerHTML = `<tr><td colspan="10" class="p-8 text-center text-slate-500">データがありません。</td></tr>`;
        return;
    }
    const { materials, groups } = categoryData;
    const sortedGroups = Object.values(groups).sort((a, b) => a.order - b.order);

    $('#status-table-body').innerHTML = sortedGroups.map(group => {
        const progress = calculateProgress(group.items, materials);
        const itemCells = materials.map(m => {
            const item = group.items[m] || { status: STATUS.NOT_APPLICABLE };
            if (item.status === STATUS.NOT_APPLICABLE) return `<td class="p-4 align-top"><span class="text-2xl text-slate-400 w-24 text-center inline-block">－</span></td>`;
            
            const hasMsg = item.message?.length > 0;
            const hasImg = item.imageUrl?.length > 0;
            const timestampInfo = item.timestamp ? `<p class="text-slate-500 font-medium">${item.timestamp}</p>` : `<p class="text-slate-400">未更新</p>`;

            return `<td class="p-4 align-top">
                <div class="flex flex-col items-center justify-start h-full">
                    <div class="flex items-center justify-center">
                        <button data-group-id="${group.id}" data-material="${m}" class="btn-toggle text-3xl p-2 rounded-full hover:bg-slate-100">${EMOJI_MAP[item.status]}</button>
                        <div class="flex flex-col ml-1 space-y-1">
                            <button data-group-id="${group.id}" data-material="${m}" class="btn-icon btn-message text-lg p-1 rounded-full hover:bg-slate-200 ${hasMsg ? 'icon-active' : 'text-slate-400'}">💬</button>
                            <button data-group-id="${group.id}" data-material="${m}" class="btn-icon btn-image text-lg p-1 rounded-full hover:bg-slate-200 ${hasImg ? 'icon-active' : 'text-slate-400'}">📸</button>
                        </div>
                    </div>
                    <div class="text-xs mt-1 text-center">${timestampInfo}</div>
                </div>
            </td>`;
        }).join('');
        return `<tr>
            <td class="p-4 font-semibold text-slate-700 text-left">
                <div class="flex items-center">
                    <span>${group.name}</span>
                    <button class="edit-group-name-btn ml-2 text-slate-400 hover:text-indigo-600" data-group-id="${group.id}" data-current-name="${group.name}"><svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z"></path><path fill-rule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clip-rule="evenodd"></path></svg></button>
                    <button class="delete-group-btn ml-1 text-slate-400 hover:text-red-600" data-group-id="${group.id}" data-group-name="${group.name}"><svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"></path></svg></button>
                </div>
            </td>
            ${itemCells}
            <td class="p-4 text-left w-40">
                <div class="text-sm font-bold text-slate-700">${progress.percent}%</div>
                <div class="progress-bar mt-1"><div class="progress-bar-inner" style="width: ${progress.percent}%;"></div></div>
                <div class="text-xs text-slate-500 mt-1">${progress.completed} / ${progress.total}</div>
            </td>
        </tr>`;
    }).join('');
};

const getNextStatus = (current) => {
    const cycle = [STATUS.UNCOLLECTED, STATUS.COLLECTED, STATUS.NOT_REQUIRED];
    return cycle[(cycle.indexOf(current) + 1) % cycle.length];
};

const subscribeToData = () => {
    if (unsubscribe) unsubscribe();
    const docRef = doc(db, COLLECTION_NAME, selectedCategory);
    unsubscribe = onSnapshot(docRef, (docSnap) => {
        hideLoader();
        if (docSnap.exists()) {
            currentCategoryData = docSnap.data();
            renderHeader(currentCategoryData.materials);
            renderBody(currentCategoryData);
        } else {
            initializeFirestoreData();
        }
    }, (error) => { console.error("Error subscribing:", error); hideLoader(); });
};

const setupEventListeners = () => {
    $('#category-selector').addEventListener('click', e => {
        const button = e.target.closest('.category-tab');
        if (button && isAppReady) {
            selectedCategory = button.dataset.category;
            showLoader('データを読み込み中...');
            renderCategorySelectors();
            subscribeToData();
        }
    });

    $('#status-table-body').addEventListener('click', async e => {
        const button = e.target.closest('button');
        if (!button || !currentCategoryData || !isAppReady) return;
        const { groupId, material, currentName, groupName } = button.dataset;
        activeModalTarget = { groupId, material };

        if (button.matches('.btn-toggle')) {
            const item = currentCategoryData.groups[groupId].items[material];
            const newStatus = getNextStatus(item.status);
            const timestamp = new Date().toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
            const docRef = doc(db, COLLECTION_NAME, selectedCategory);
            await updateDoc(docRef, { 
                [`groups.${groupId}.items.${material}.status`]: newStatus,
                [`groups.${groupId}.items.${material}.timestamp`]: timestamp,
                [`groups.${groupId}.items.${material}.updatedBy`]: auth.currentUser.uid,
             });
        } else if (button.matches('.btn-message')) {
            const currentMessage = currentCategoryData.groups[groupId].items[material].message;
            $('#message-modal-target').textContent = `${currentCategoryData.groups[groupId].name} ${material}`;
            $('#message-input').value = currentMessage;
            $('#message-modal').classList.remove('hidden');
            $('#message-input').focus();
        } else if (button.matches('.btn-image')) {
            const imageUrl = currentCategoryData.groups[groupId].items[material].imageUrl;
            if (imageUrl) {
                $('#image-modal-target').textContent = `${currentCategoryData.groups[groupId].name} ${material}`;
                $('#image-preview').src = imageUrl;
                $('#image-viewer-modal').classList.remove('hidden');
            } else {
                $('#image-upload-input').click();
            }
        } else if (button.matches('.edit-group-name-btn')) {
            $('#edit-group-name-input').value = currentName;
            $('#edit-group-name-modal').classList.remove('hidden');
            $('#edit-group-name-input').focus();
        } else if (button.matches('.delete-group-btn')) {
            if (confirm(`「${groupName}」を削除しますか？この操作は元に戻せません。`)) {
                const docRef = doc(db, COLLECTION_NAME, selectedCategory);
                await updateDoc(docRef, { [`groups.${groupId}`]: deleteField() });
            }
        }
    });

    $('#image-upload-input').addEventListener('change', async e => {
        const file = e.target.files[0];
        if (!file) return;
        const { groupId, material } = activeModalTarget;
        showLoader('画像をアップロード中...');
        
        const UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
        const formData = new FormData();
        formData.append('file', file);
        formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

        try {
            const res = await fetch(UPLOAD_URL, { method: 'POST', body: formData });
            const data = await res.json();
            if (data.secure_url) {
                const downloadURL = data.secure_url;
                const docRef = doc(db, COLLECTION_NAME, selectedCategory);
                await updateDoc(docRef, { [`groups.${groupId}.items.${material}.imageUrl`]: downloadURL });
            } else {
                throw new Error('Cloudinary upload failed');
            }
        } catch (error) {
            console.error("Upload failed", error);
            alert("画像のアップロードに失敗しました。");
        } finally {
            hideLoader();
            e.target.value = '';
        }
    });

    const setupModal = (modalId, openTriggerSelector, closeSelectors, confirmAction) => {
        if (openTriggerSelector) $(openTriggerSelector).addEventListener('click', () => { if(isAppReady) $(modalId).classList.remove('hidden'); });
        closeSelectors.forEach(sel => $(sel).addEventListener('click', () => $(modalId).classList.add('hidden')));
        if (confirmAction) confirmAction();
    };
    
    setupModal('#add-group-modal', '#add-group-btn', ['#cancel-add-group'], () => {
        $('#confirm-add-group').addEventListener('click', async () => {
            const newName = $('#new-group-name').value.trim();
            if (newName) {
                const newGroupId = crypto.randomUUID();
                const newGroup = {
                    id: newGroupId, name: newName, order: Object.keys(currentCategoryData.groups || {}).length,
                    items: {}
                };
                currentCategoryData.materials.forEach(m => {
                    newGroup.items[m] = { status: STATUS.UNCOLLECTED, message: '', imageUrl: '', timestamp: '', updatedBy: '' };
                });
                const docRef = doc(db, COLLECTION_NAME, selectedCategory);
                await updateDoc(docRef, { [`groups.${newGroupId}`]: newGroup });
                $('#new-group-name').value = '';
                $('#add-group-modal').classList.add('hidden');
            }
        });
    });

    setupModal('#edit-group-name-modal', null, ['#cancel-edit-group-name'], () => {
        $('#save-group-name').addEventListener('click', async () => {
            const { groupId } = activeModalTarget;
            const newName = $('#edit-group-name-input').value.trim();
            if (newName && groupId) {
                const docRef = doc(db, COLLECTION_NAME, selectedCategory);
                await updateDoc(docRef, { [`groups.${groupId}.name`]: newName });
                $('#edit-group-name-modal').classList.add('hidden');
            }
        });
    });

    setupModal('#message-modal', null, ['#cancel-message'], () => {
        $('#save-message').addEventListener('click', async () => {
            const { groupId, material } = activeModalTarget;
            const newMessage = $('#message-input').value;
            const docRef = doc(db, COLLECTION_NAME, selectedCategory);
            await updateDoc(docRef, { [`groups.${groupId}.items.${material}.message`]: newMessage });
            $('#message-modal').classList.add('hidden');
        });
    });

    setupModal('#image-viewer-modal', null, ['#close-image-viewer'], () => {
        $('#delete-image-btn').addEventListener('click', async () => {
            if (confirm('この画像を削除しますか？\n（Cloudinaryからは削除されません）')) {
                const { groupId, material } = activeModalTarget;
                const docRef = doc(db, COLLECTION_NAME, selectedCategory);
                await updateDoc(docRef, { [`groups.${groupId}.items.${material}.imageUrl`]: '' });
                $('#image-viewer-modal').classList.add('hidden');
            }
        });
    });

    setupModal('#add-item-modal', '#add-item-btn', ['#cancel-add-item'], () => {
        $('#confirm-add-item').addEventListener('click', async () => {
            const newItemName = $('#new-item-name').value.trim();
            if (newItemName && !currentCategoryData.materials.includes(newItemName)) {
                const docRef = doc(db, COLLECTION_NAME, selectedCategory);
                const updates = { materials: arrayUnion(newItemName) };
                Object.keys(currentCategoryData.groups).forEach(groupId => { updates[`groups.${groupId}.items.${newItemName}`] = { status: STATUS.UNCOLLECTED, message: '', imageUrl: '', timestamp: '', updatedBy: '' }; });
                await updateDoc(docRef, updates);
                $('#new-item-name').value = '';
                $('#add-item-modal').classList.add('hidden');
            }
        });
    });
    
    $('#table-header').addEventListener('click', e => {
        if (e.target.matches('.delete-item-btn')) {
            activeModalTarget.itemName = e.target.dataset.itemName;
            $('#item-to-delete-name').textContent = activeModalTarget.itemName;
            $('#delete-item-modal').classList.remove('hidden');
        }
    });
    setupModal('#delete-item-modal', null, ['#cancel-delete-item'], () => {
         $('#confirm-delete-item').addEventListener('click', async () => {
            const { itemName } = activeModalTarget;
            if (itemName) {
                const docRef = doc(db, COLLECTION_NAME, selectedCategory);
                const updates = { materials: arrayRemove(itemName) };
                Object.keys(currentCategoryData.groups).forEach(groupId => { updates[`groups.${groupId}.items.${itemName}`] = deleteField(); });
                await updateDoc(docRef, updates);
                $('#delete-item-modal').classList.add('hidden');
            }
        });
    });

    setupModal('#reset-modal', '#reset-button', ['#cancel-reset-btn'], () => {
        $('#confirm-reset-btn').addEventListener('click', async () => {
            $('#reset-modal').classList.add('hidden');
            await initializeFirestoreData();
        });
    });
};

async function main() {
    showLoader('アプリを初期化中...');
    try {
        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        
        await signInAnonymously(auth);

        isAppReady = true;
        setupEventListeners();
        renderCategorySelectors();
        subscribeToData();
        
    } catch (e) {
        console.error("Initialization failed:", e);
        hideLoader();
        document.body.innerHTML = `<div class="p-8 text-center text-red-500">アプリの初期化に失敗しました。FirebaseやCloudinaryの情報が正しく設定されているか確認してください。</div>`;
    }
}

document.addEventListener('DOMContentLoaded', main);
