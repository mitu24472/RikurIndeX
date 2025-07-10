import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, onSnapshot, writeBatch, updateDoc, arrayUnion, arrayRemove, deleteField, collection } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";



const firebaseConfig = {
  apiKey: "AIzaSyDkgSR2WXVMbghkUkBp2xT3gmXndUW70bQ",
  authDomain: "handout-manager.firebaseapp.com",
  projectId: "handout-manager",
  storageBucket: "handout-manager.firebasestorage.app",
  messagingSenderId: "485386568974",
  appId: "1:485386568974:web:488e1a88f9ed6ecea7c35f",
  measurementId: "G-LNYDWJZGZL"
};

const CLOUDINARY_CLOUD_NAME = "dgnloysyh";
const CLOUDINARY_UPLOAD_PRESET = "cvw7nkty";


const CATEGORIES = ['1年生', '2年生', '3年生', '4年生', '5年生', '6年生', '部活動'];
const INITIAL_GROUP_IDS = ['A', 'B', 'C', 'D'];
const STATUS = { COLLECTED: 'collected', UNCOLLECTED: 'uncollected', NOT_REQUIRED: 'not_required', NOT_APPLICABLE: 'na' };
const EMOJI_MAP = { [STATUS.COLLECTED]: '✅', [STATUS.UNCOLLECTED]: '🟡', [STATUS.NOT_REQUIRED]: '🚫' };
const COLLECTION_NAME = 'handouts_data_v11_inventory_fix'; 
const INVENTORY_DOC_ID = 'committee_inventory';

const $ = (selector) => document.querySelector(selector);
let db, auth;
let unsubscribeFromCollection;
let selectedCategory = '1年生';
let allCategoriesData = {}; 
let committeeInventory = {};
let activeModalTarget = {};
let isAppReady = false;
let inventoryChart = null;

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
                message: '', imageUrl: '', timestamp: '', updatedBy: '', required: 0
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
        const inventoryRef = doc(db, COLLECTION_NAME, INVENTORY_DOC_ID);
        batch.set(inventoryRef, {すのこ: 0, 暗幕: 0, ドア: 0});
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
    const headerRow = `<tr><th class="p-4 font-semibold text-slate-600 text-left text-sm tracking-wider">グループ</th>${materials.map(m => `<th class="p-4 font-semibold text-slate-600 text-sm tracking-wider min-w-[160px]">${m} <button data-item-name="${m}" class="delete-item-btn text-red-400 hover:text-red-600 ml-1">×</button></th>`).join('')}<th class="p-4 font-semibold text-slate-600 text-sm tracking-wider text-left">完了率</th></tr>`;
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

            const imageActionHtml = hasImg
                ? `<button data-group-id="${group.id}" data-material="${m}" class="btn-icon btn-image text-lg p-1 rounded-full hover:bg-slate-200 icon-active">📸</button>`
                : `<button data-group-id="${group.id}" data-material="${m}" class="btn-upload-img text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold py-1 px-2 rounded-md shadow-sm">アップロード</button>`;

            return `<td class="p-4 align-top">
                <div class="flex flex-col items-center justify-start h-full">
                    <div class="flex items-center justify-center">
                        <button data-group-id="${group.id}" data-material="${m}" class="btn-toggle text-3xl p-2 rounded-full hover:bg-slate-100">${EMOJI_MAP[item.status]}</button>
                        <div class="flex flex-col ml-2 space-y-1.5">
                            <button data-group-id="${group.id}" data-material="${m}" class="btn-icon btn-message text-lg p-1 rounded-full hover:bg-slate-200 ${hasMsg ? 'icon-active' : 'text-slate-400'}">💬</button>
                            ${imageActionHtml}
                        </div>
                    </div>
                    <div class="text-xs mt-1 text-center">${timestampInfo}</div>
                    <div class="mt-2">
                        <label class="text-xs font-medium text-slate-500">必要数:</label>
                        <input type="number" min="0" value="${item.required || 0}" data-group-id="${group.id}" data-material="${m}" class="requirement-input-collection w-20 text-center border-slate-300 rounded-md p-1 focus:ring-indigo-500 focus:border-indigo-500">
                    </div>
                </div>
            </td>`;
        }).join('');
        return `<tr>
            <td class="p-4 font-semibold text-slate-700 text-left align-top">
                <div class="flex items-center">
                    <span>${group.name}</span>
                    <button class="edit-group-name-btn ml-2 text-slate-400 hover:text-indigo-600" data-group-id="${group.id}" data-current-name="${group.name}"><svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z"></path><path fill-rule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clip-rule="evenodd"></path></svg></button>
                    <button class="delete-group-btn ml-1 text-slate-400 hover:text-red-600" data-group-id="${group.id}" data-group-name="${group.name}"><svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"></path></svg></button>
                </div>
            </td>
            ${itemCells}
            <td class="p-4 text-left w-40 align-top">
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

const renderApp = () => {
    hideLoader();
    const currentData = allCategoriesData[selectedCategory];
    if (!currentData) return;
    
    renderHeader(currentData.materials);
    renderBody(currentData);
    
    if (!$('#view-inventory').classList.contains('hidden')) {
        renderCommitteeInventory();
        updateChart();
    }
};

const renderCommitteeInventory = () => {
    const allMaterials = Object.keys(committeeInventory).sort();
    const container = $('#committee-inventory-inputs');
    container.innerHTML = allMaterials.map(m => `
        <div class="flex items-center">
            <label class="w-24 font-medium text-slate-700">${m}</label>
            <input type="number" min="0" data-item-name="${m}" value="${committeeInventory[m] || 0}" class="inventory-input w-full border-slate-300 rounded-md p-2 focus:ring-indigo-500 focus:border-indigo-500">
        </div>
    `).join('');
};

const updateChart = () => {
    const allMaterials = Object.keys(committeeInventory).sort();
    const totalRequired = {};
    allMaterials.forEach(m => {
        let sum = 0;
        Object.values(allCategoriesData).forEach(catData => {
            if(catData && catData.groups) {
                sum += Object.values(catData.groups).reduce((s, group) => s + (group.items[m]?.required || 0), 0);
            }
        });
        totalRequired[m] = sum;
    });

    const chartData = {
        labels: allMaterials,
        datasets: [
            { label: '必要数', data: allMaterials.map(m => totalRequired[m]), backgroundColor: 'rgba(255, 99, 132, 0.5)' },
            { label: '在庫数', data: allMaterials.map(m => committeeInventory[m] || 0), backgroundColor: 'rgba(54, 162, 235, 0.5)' }
        ]
    };

    const ctx = $('#inventory-chart').getContext('2d');
    if (inventoryChart) {
        inventoryChart.data = chartData;
        inventoryChart.update();
    } else {
        inventoryChart = new Chart(ctx, { type: 'bar', data: chartData, options: { scales: { y: { beginAtZero: true } }, responsive: true, maintainAspectRatio: false } });
    }
};

const calculateAndDisplayAllocation = () => {
    const allMaterials = Object.keys(committeeInventory).sort();
    let html = '';

    const priorityOrder = ['6年生', '5年生', '4年生', '3年生', '2年生', '1年生', '部活動'];

    allMaterials.forEach(item => {
        let supply = committeeInventory[item] || 0;
        
        const demandList = [];
        priorityOrder.forEach(category => {
            const categoryData = allCategoriesData[category];
            if (categoryData && categoryData.groups) {
                Object.values(categoryData.groups).sort((a,b) => a.order - b.order).forEach(group => {
                    const required = group.items[item]?.required || 0;
                    if (required > 0) {
                        demandList.push({ category, group, required });
                    }
                });
            }
        });

        const totalDemand = demandList.reduce((sum, d) => sum + d.required, 0);
        html += `<div class="mb-6"><h4 class="font-bold text-lg text-indigo-700 mb-2">${item}</h4>`;
        html += `<p class="text-sm mb-2">在庫: ${supply} / 全体必要数: ${totalDemand}</p>`;

        if (totalDemand === 0) {
            html += `<p class="text-sm text-slate-500">必要としているグループはありません。</p></div>`;
            return;
        }

        const allocation = {}; 
        demandList.forEach(d => {
            const allocatedAmount = Math.min(d.required, supply);
            allocation[d.group.id] = allocatedAmount;
            supply -= allocatedAmount;
        });

        html += `<table class="w-full text-sm text-left">
            <thead class="bg-slate-100"><tr><th class="p-2 font-semibold">グループ</th><th class="p-2 font-semibold">必要数</th><th class="p-2 font-semibold">分配数</th></tr></thead>
            <tbody>`;
        
        priorityOrder.forEach(category => {
             const categoryData = allCategoriesData[category];
             if (categoryData && categoryData.groups) {
                Object.values(categoryData.groups).sort((a,b) => a.order - b.order).forEach(group => {
                    const required = group.items[item]?.required || 0;
                    if(required > 0) {
                        const allocated = allocation[group.id] || 0;
                        const textColor = allocated < required ? 'text-red-600' : 'text-green-600';
                        html += `<tr class="border-b"><td class="p-2">${category.replace('年生', '年')}-${group.name}</td><td class="p-2">${required}</td><td class="p-2 font-bold ${textColor}">${allocated}</td></tr>`;
                    }
                });
             }
        });

        html += `</tbody></table></div>`;
    });
    
    $('#allocation-result').innerHTML = html;
};

const setupEventListeners = () => {
    // Main Tabs
    $('#tab-collection').addEventListener('click', () => {
        $('#view-collection').classList.remove('hidden');
        $('#view-inventory').classList.add('hidden');
        $('#tab-collection').classList.add('active');
        $('#tab-inventory').classList.remove('active');
    });
    $('#tab-inventory').addEventListener('click', () => {
        $('#view-inventory').classList.remove('hidden');
        $('#view-collection').classList.add('hidden');
        $('#tab-inventory').classList.add('active');
        $('#tab-collection').classList.remove('active');
        renderCommitteeInventory();
        updateChart();
    });

    // Inventory View Listeners
    $('#committee-inventory-inputs').addEventListener('change', async (e) => {
        if (e.target.matches('.inventory-input')) {
            const itemName = e.target.dataset.itemName;
            const value = parseInt(e.target.value, 10) || 0;
            const docRef = doc(db, COLLECTION_NAME, INVENTORY_DOC_ID);
            await updateDoc(docRef, { [itemName]: value });
        }
    });
    $('#calculate-allocation-btn').addEventListener('click', calculateAndDisplayAllocation);

    // Collection View Listeners
    $('#category-selector').addEventListener('click', e => {
        const button = e.target.closest('.category-tab');
        if (button && isAppReady) {
            selectedCategory = button.dataset.category;
            renderCategorySelectors();
            renderApp();
        }
    });

    $('#status-table-body').addEventListener('click', async e => {
        const button = e.target.closest('button');
        if (!button || !allCategoriesData[selectedCategory] || !isAppReady) return;
        const { groupId, material, currentName, groupName } = button.dataset;
        activeModalTarget = { groupId, material };

        if (button.matches('.btn-toggle')) {
            const item = allCategoriesData[selectedCategory].groups[groupId].items[material];
            const newStatus = getNextStatus(item.status);
            const timestamp = new Date().toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
            const docRef = doc(db, COLLECTION_NAME, selectedCategory);
            await updateDoc(docRef, { 
                [`groups.${groupId}.items.${material}.status`]: newStatus,
                [`groups.${groupId}.items.${material}.timestamp`]: timestamp,
                [`groups.${groupId}.items.${material}.updatedBy`]: auth.currentUser.uid,
             });
        } else if (button.matches('.btn-message')) {
            const currentMessage = allCategoriesData[selectedCategory].groups[groupId].items[material].message;
            $('#message-modal-target').textContent = `${allCategoriesData[selectedCategory].groups[groupId].name} ${material}`;
            $('#message-input').value = currentMessage;
            $('#message-modal').classList.remove('hidden');
            $('#message-input').focus();
        } else if (button.matches('.btn-image')) {
            const imageUrl = allCategoriesData[selectedCategory].groups[groupId].items[material].imageUrl;
            if (imageUrl) {
                $('#image-modal-target').textContent = `${allCategoriesData[selectedCategory].groups[groupId].name} ${material}`;
                $('#image-preview').src = imageUrl;
                $('#image-viewer-modal').classList.remove('hidden');
            }
        } else if (button.matches('.btn-upload-img')) {
             $('#image-upload-input').click();
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

    $('#status-table-body').addEventListener('change', async (e) => {
        if (e.target.matches('.requirement-input-collection')) {
            const { groupId, material } = e.target.dataset;
            let value = parseInt(e.target.value, 10) || 0;
            if (value < 0) {
                value = 0;
                e.target.value = 0;
            }
            const docRef = doc(db, COLLECTION_NAME, selectedCategory);
            await updateDoc(docRef, { [`groups.${groupId}.items.${material}.required`]: value });
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
            if (data.error) throw new Error(data.error.message);
            const downloadURL = data.secure_url;
            const docRef = doc(db, COLLECTION_NAME, selectedCategory);
            await updateDoc(docRef, { [`groups.${groupId}.items.${material}.imageUrl`]: downloadURL });
        } catch (error) {
            console.error("Upload failed:", error);
            alert(`画像のアップロードに失敗しました: ${error.message}`);
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
                    id: newGroupId, name: newName, order: Object.keys(allCategoriesData[selectedCategory].groups || {}).length,
                    items: {}
                };
                allCategoriesData[selectedCategory].materials.forEach(m => {
                    newGroup.items[m] = { status: STATUS.UNCOLLECTED, message: '', imageUrl: '', timestamp: '', updatedBy: '', required: 0 };
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
            if (confirm('このアプリから画像の関連付けを削除しますか？\n（画像自体はCloudinaryに残ります）')) {
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
            if (newItemName && !allCategoriesData[selectedCategory].materials.includes(newItemName)) {
                const batch = writeBatch(db);
                CATEGORIES.forEach(category => {
                    const docRef = doc(db, COLLECTION_NAME, category);
                    const updates = { materials: arrayUnion(newItemName) };
                    const categoryData = allCategoriesData[category];
                    if(categoryData && categoryData.groups) {
                        Object.keys(categoryData.groups).forEach(groupId => { updates[`groups.${groupId}.items.${newItemName}`] = { status: STATUS.UNCOLLECTED, message: '', imageUrl: '', timestamp: '', updatedBy: '', required: 0 }; });
                    }
                    batch.update(docRef, updates);
                });
                const inventoryRef = doc(db, COLLECTION_NAME, INVENTORY_DOC_ID);
                batch.update(inventoryRef, { [newItemName]: 0 });

                await batch.commit();
                
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
                const batch = writeBatch(db);
                CATEGORIES.forEach(category => {
                    const docRef = doc(db, COLLECTION_NAME, category);
                    const updates = { materials: arrayRemove(itemName) };
                    const categoryData = allCategoriesData[category];
                     if(categoryData && categoryData.groups) {
                        Object.keys(categoryData.groups).forEach(groupId => { updates[`groups.${groupId}.items.${itemName}`] = deleteField(); });
                    }
                    batch.update(docRef, updates);
                });
                const inventoryRef = doc(db, COLLECTION_NAME, INVENTORY_DOC_ID);
                batch.update(inventoryRef, {[itemName]: deleteField()});
                
                await batch.commit();
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

        setupEventListeners();
        renderCategorySelectors();

        // Listen to the entire collection for real-time updates
        unsubscribeFromCollection = onSnapshot(collection(db, COLLECTION_NAME), (querySnapshot) => {
            if (querySnapshot.empty) {
                if (!isAppReady) initializeFirestoreData();
                return;
            }

            let dataLoaded = false;
            querySnapshot.forEach(doc => {
                if (doc.id === INVENTORY_DOC_ID) {
                    committeeInventory = doc.data();
                } else {
                    allCategoriesData[doc.id] = doc.data();
                }
                dataLoaded = true;
            });
            
            if(dataLoaded) {
                 if (!isAppReady) {
                    isAppReady = true;
                    $('#tab-collection').classList.add('active');
                }
                renderApp();
            }
        });
        
    } catch (e) {
        console.error("Initialization failed:", e);
        hideLoader();
        document.body.innerHTML = `<div class="p-8 text-center text-red-500">アプリの初期化に失敗しました。FirebaseやCloudinaryの情報が正しく設定されているか、もう一度ご確認ください。特に、Firebaseの匿名認証が有効になっているか確認してください。</div>`;
    }
}

document.addEventListener('DOMContentLoaded', main);