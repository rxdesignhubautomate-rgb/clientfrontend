const DATABASE_VERSION = 2;
const MAX_CACHED_CONVERSATIONS = 10_000;
const MAX_CACHED_MESSAGES = 10_000;
const MAX_CACHED_MESSAGES_PER_CONVERSATION = 500;

export function createChatCache(userKey) {
  if (!("indexedDB" in window) || !userKey) return createNoopCache();
  return new IndexedChatCache(`rx-crm-chat-cache-${stableKey(userKey)}`);
}

class IndexedChatCache {
  constructor(databaseName) {
    this.databaseName = databaseName;
    this.databasePromise = null;
  }

  async getConversations() {
    const database = await this.open();
    if (!database) return [];
    const values = await requestResult(database.transaction("conversations").objectStore("conversations").getAll());
    return values
      .sort((left, right) => timestamp(right.lastMessageAt) - timestamp(left.lastMessageAt))
      .slice(0, MAX_CACHED_CONVERSATIONS);
  }

  async putConversations(conversations) {
    if (!conversations?.length) return;
    const database = await this.open();
    if (!database) return;
    const transaction = database.transaction("conversations", "readwrite");
    const store = transaction.objectStore("conversations");
    for (const conversation of conversations) {
      const id = conversation.conversationId || conversation.id;
      if (id) store.put({ ...conversation, conversationId: id, cachedAt: new Date().toISOString() });
    }
    await transactionDone(transaction);
    await this.trimConversations(database);
  }

  async getMessages(conversationId) {
    if (!conversationId) return [];
    const database = await this.open();
    if (!database) return [];
    const store = database.transaction("messages").objectStore("messages");
    const values = await requestResult(store.index("conversationId").getAll(conversationId));
    return values
      .sort((left, right) => timestamp(left.createdAt) - timestamp(right.createdAt))
      .slice(-MAX_CACHED_MESSAGES_PER_CONVERSATION);
  }

  async putMessages(messages) {
    if (!messages?.length) return;
    const database = await this.open();
    if (!database) return;
    const transaction = database.transaction("messages", "readwrite");
    const store = transaction.objectStore("messages");
    for (const message of messages) {
      const id = message.messageId || message.id;
      if (id && message.conversationId) store.put({ ...message, messageId: id, cachedAt: new Date().toISOString() });
    }
    await transactionDone(transaction);
    const conversationIds = [...new Set(messages.map((message) => message.conversationId).filter(Boolean))];
    await Promise.all(conversationIds.map((conversationId) => this.trimMessages(database, conversationId)));
    await this.trimTotalMessages(database);
  }

  async getOverview(contactId) {
    if (!contactId) return null;
    const database = await this.open();
    if (!database) return null;
    return requestResult(database.transaction("overviews").objectStore("overviews").get(contactId));
  }

  async putOverview(contactId, value) {
    if (!contactId || !value) return;
    const database = await this.open();
    if (!database) return;
    const transaction = database.transaction("overviews", "readwrite");
    transaction.objectStore("overviews").put({
      contactId,
      value,
      cachedAt: new Date().toISOString()
    });
    await transactionDone(transaction);
  }

  async getMeta(key) {
    const database = await this.open();
    if (!database) return null;
    return (await requestResult(database.transaction("meta").objectStore("meta").get(key)))?.value ?? null;
  }

  async setMeta(key, value) {
    const database = await this.open();
    if (!database) return;
    const transaction = database.transaction("meta", "readwrite");
    transaction.objectStore("meta").put({ key, value });
    await transactionDone(transaction);
  }

  open() {
    if (this.databasePromise) return this.databasePromise;
    this.databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, DATABASE_VERSION);
      request.addEventListener("upgradeneeded", () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("conversations")) {
          const conversations = database.createObjectStore("conversations", { keyPath: "conversationId" });
          conversations.createIndex("lastMessageAt", "lastMessageAt", { unique: false });
        } else {
          const conversations = request.transaction.objectStore("conversations");
          if (!conversations.indexNames.contains("lastMessageAt")) {
            conversations.createIndex("lastMessageAt", "lastMessageAt", { unique: false });
          }
        }
        if (!database.objectStoreNames.contains("messages")) {
          const messages = database.createObjectStore("messages", { keyPath: "messageId" });
          messages.createIndex("conversationId", "conversationId", { unique: false });
          messages.createIndex("cachedAt", "cachedAt", { unique: false });
        } else {
          const messages = request.transaction.objectStore("messages");
          if (!messages.indexNames.contains("cachedAt")) {
            messages.createIndex("cachedAt", "cachedAt", { unique: false });
          }
        }
        if (!database.objectStoreNames.contains("overviews")) {
          database.createObjectStore("overviews", { keyPath: "contactId" });
        }
        if (!database.objectStoreNames.contains("meta")) {
          database.createObjectStore("meta", { keyPath: "key" });
        }
      });
      request.addEventListener("success", () => resolve(request.result), { once: true });
      request.addEventListener("error", () => reject(request.error), { once: true });
      request.addEventListener("blocked", () => reject(new Error("Chat cache database is blocked")), { once: true });
    }).catch((error) => {
      console.warn("Local chat cache is unavailable", error);
      return null;
    });
    return this.databasePromise;
  }

  async trimConversations(database) {
    if (!database) return;
    const transaction = database.transaction("conversations", "readwrite");
    const complete = transactionDone(transaction);
    const store = transaction.objectStore("conversations");
    let excess = (await requestResult(store.count())) - MAX_CACHED_CONVERSATIONS;
    const obsolete = [];
    if (excess > 0) {
      await new Promise((resolve, reject) => {
        const request = store.index("lastMessageAt").openCursor();
        request.addEventListener("success", () => {
          const cursor = request.result;
          if (!cursor || excess <= 0) return resolve();
          obsolete.push(cursor.value);
          cursor.delete();
          excess -= 1;
          cursor.continue();
        });
        request.addEventListener("error", () => reject(request.error), { once: true });
      });
    }
    await complete;
    await Promise.all(obsolete.map((conversation) => this.removeConversationData(database, conversation)));
  }

  async trimMessages(database, conversationId) {
    if (!database) return;
    const transaction = database.transaction("messages", "readwrite");
    const store = transaction.objectStore("messages");
    const values = await requestResult(store.index("conversationId").getAll(conversationId));
    const obsolete = values
      .sort((left, right) => timestamp(right.createdAt) - timestamp(left.createdAt))
      .slice(MAX_CACHED_MESSAGES_PER_CONVERSATION);
    obsolete.forEach((message) => store.delete(message.messageId));
    await transactionDone(transaction);
  }

  async trimTotalMessages(database) {
    const transaction = database.transaction("messages", "readwrite");
    const complete = transactionDone(transaction);
    const store = transaction.objectStore("messages");
    let excess = (await requestResult(store.count())) - MAX_CACHED_MESSAGES;
    if (excess > 0) {
      await new Promise((resolve, reject) => {
        const request = store.index("cachedAt").openCursor();
        request.addEventListener("success", () => {
          const cursor = request.result;
          if (!cursor || excess <= 0) return resolve();
          cursor.delete();
          excess -= 1;
          cursor.continue();
        });
        request.addEventListener("error", () => reject(request.error), { once: true });
      });
    }
    await complete;
  }

  async removeConversationData(database, conversation) {
    const transaction = database.transaction(["messages", "overviews"], "readwrite");
    const messages = transaction.objectStore("messages");
    const keys = await requestResult(messages.index("conversationId").getAllKeys(conversation.conversationId));
    keys.forEach((key) => messages.delete(key));
    if (conversation.contactId) transaction.objectStore("overviews").delete(conversation.contactId);
    await transactionDone(transaction);
  }
}

function createNoopCache() {
  return {
    getConversations: async () => [],
    putConversations: async () => {},
    getMessages: async () => [],
    putMessages: async () => {},
    getOverview: async () => null,
    putOverview: async () => {},
    getMeta: async () => null,
    setMeta: async () => {}
  };
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", resolve, { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error), { once: true });
  });
}

function stableKey(value) {
  let hash = 2166136261;
  for (const character of String(value).toLowerCase()) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function timestamp(value) {
  if (!value) return 0;
  if (value._seconds) return value._seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}
