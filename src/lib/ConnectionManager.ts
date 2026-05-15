/**
 * ConnectionManager - Centralized WebSocket and API management with heartbeat support
 * 
 * Features:
 * - WebSocket connection with 5s heartbeat ping/pong
 * - Automatic reconnection with exponential backoff
 * - Visibility change detection for wake-from-sleep scenarios
 * - Centralized API requests that detect connection failures
 * - Connection status events for UI updates
 */

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

type StatusListener = (status: ConnectionStatus) => void;
type MessageListener = (data: unknown) => void;

const API_BASE = import.meta.env.PROD ? '' : 'http://localhost:3001';
const WS_BASE = import.meta.env.PROD
  ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`
  : 'ws://localhost:3001';

// Reconnection configuration
const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;
const RECONNECT_BACKOFF_MULTIPLIER = 2;

// Heartbeat configuration
const HEARTBEAT_INTERVAL = 5000; // 5 seconds
const HEARTBEAT_TIMEOUT = 3000;  // 3 seconds to receive pong

class ConnectionManagerImpl {
  private ws: WebSocket | null = null;
  private teamId: string | null = null;
  private status: ConnectionStatus = 'disconnected';
  private statusListeners = new Set<StatusListener>();
  private messageListeners = new Set<MessageListener>();
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = INITIAL_RECONNECT_DELAY;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimeout: ReturnType<typeof setTimeout> | null = null;
  private awaitingPong = false;
  private isConnecting = false;

  constructor() {
    // Listen for visibility changes (wake from sleep)
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  private handleVisibilityChange = () => {
    if (document.visibilityState === 'visible' && this.teamId) {
      // Page became visible - check connection health
      if (this.ws?.readyState === WebSocket.OPEN) {
        // Send immediate ping to verify connection is alive
        this.sendPing();
      } else if (this.status !== 'connecting' && this.status !== 'reconnecting') {
        // Connection is dead, reconnect immediately
        console.log('Page visible, connection dead - reconnecting');
        this.reconnectDelay = INITIAL_RECONNECT_DELAY;
        this.connect(this.teamId);
      }
    }
  };

  private setStatus(newStatus: ConnectionStatus) {
    if (this.status !== newStatus) {
      this.status = newStatus;
      this.statusListeners.forEach(listener => listener(newStatus));
    }
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    // Immediately call with current status
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  onMessage(listener: MessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  connect(teamId: string) {
    if (this.isConnecting && this.teamId === teamId) return;
    
    this.teamId = teamId;
    this.isConnecting = true;
    this.cleanup();
    
    this.setStatus(this.reconnectDelay > INITIAL_RECONNECT_DELAY ? 'reconnecting' : 'connecting');
    
    const ws = new WebSocket(`${WS_BASE}/ws/${teamId}`);
    this.ws = ws;

    ws.onopen = () => {
      console.log('WebSocket connected');
      this.isConnecting = false;
      this.setStatus('connected');
      this.reconnectDelay = INITIAL_RECONNECT_DELAY;
      this.startHeartbeat();
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        // Handle pong response
        if (data.type === 'pong') {
          this.awaitingPong = false;
          if (this.heartbeatTimeout) {
            clearTimeout(this.heartbeatTimeout);
            this.heartbeatTimeout = null;
          }
          return;
        }
        
        this.messageListeners.forEach(listener => listener(data));
      } catch (err) {
        console.error('WebSocket message error:', err);
      }
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      this.isConnecting = false;
      this.stopHeartbeat();
      this.setStatus('disconnected');
      this.scheduleReconnect();
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => this.sendPing(), HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
    this.awaitingPong = false;
  }

  private sendPing() {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    if (this.awaitingPong) {
      // Previous ping didn't get a response - connection is dead
      console.log('Heartbeat timeout - reconnecting');
      this.ws.close();
      return;
    }
    
    this.awaitingPong = true;
    this.ws.send(JSON.stringify({ type: 'ping' }));
    
    this.heartbeatTimeout = setTimeout(() => {
      if (this.awaitingPong) {
        console.log('Heartbeat timeout - reconnecting');
        this.ws?.close();
      }
    }, HEARTBEAT_TIMEOUT);
  }

  private scheduleReconnect() {
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    if (!this.teamId) return;

    const delay = this.reconnectDelay;
    console.log(`Reconnecting in ${delay}ms...`);

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectDelay = Math.min(
        this.reconnectDelay * RECONNECT_BACKOFF_MULTIPLIER,
        MAX_RECONNECT_DELAY
      );
      if (this.teamId) this.connect(this.teamId);
    }, delay);
  }

  private cleanup() {
    this.stopHeartbeat();
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
  }

  send(data: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  disconnect() {
    this.teamId = null;
    this.cleanup();
    this.setStatus('disconnected');
  }

  // Centralized API fetch with connection status awareness
  async fetch<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${API_BASE}${path}`;

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
      });

      if (!response.ok) {
        const error = new Error(`API error: ${response.status}`) as Error & { status: number };
        error.status = response.status;
        throw error;
      }

      return response.json();
    } catch (err) {
      // Network error - likely indicates connection issues
      if (err instanceof TypeError && err.message.includes('fetch')) {
        console.error('Network error - API unreachable');
        // If WebSocket is also disconnected, we have a connectivity problem
        if (this.status !== 'connected') {
          this.setStatus('disconnected');
        }
      }
      throw err;
    }
  }

  // Convenience methods for common HTTP methods
  async get<T>(path: string): Promise<T> {
    return this.fetch<T>(path, { method: 'GET' });
  }

  async post<T>(path: string, body?: object): Promise<T> {
    return this.fetch<T>(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async put<T>(path: string, body?: object): Promise<T> {
    return this.fetch<T>(path, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async delete<T>(path: string): Promise<T> {
    return this.fetch<T>(path, { method: 'DELETE' });
  }
}

// Singleton instance
export const ConnectionManager = new ConnectionManagerImpl();
