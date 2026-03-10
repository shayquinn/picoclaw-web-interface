// PicoClaw - Ultra-lightweight personal AI agent
// License: MIT
//
// Copyright (c) 2026 PicoClaw contributors

package channels

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/sipeed/picoclaw/pkg/bus"
	"github.com/sipeed/picoclaw/pkg/config"
	"github.com/sipeed/picoclaw/pkg/logger"
)

// WebChannel provides an HTTP REST API for the web interface to communicate
// with PicoClaw. It registers handlers on the shared HTTP server:
//   - POST /api/chat  — send a message and receive a response
//   - GET  /api/health — liveness check
type WebChannel struct {
	*BaseChannel
	config    config.WebConfig
	pendingMu sync.Mutex
	pending   map[string]chan string // chat_id -> response channel
}

type webChatRequest struct {
	Message string `json:"message"`
	ChatID  string `json:"chat_id,omitempty"`
}

type webChatResponse struct {
	Success  bool   `json:"success"`
	Response string `json:"response"`
	ChatID   string `json:"chat_id"`
}

func NewWebChannel(cfg config.WebConfig, msgBus *bus.MessageBus) (*WebChannel, error) {
	base := NewBaseChannel("web", cfg, msgBus, cfg.AllowFrom)
	return &WebChannel{
		BaseChannel: base,
		config:      cfg,
		pending:     make(map[string]chan string),
	}, nil
}

func (c *WebChannel) Start(ctx context.Context) error {
	c.SetRunning(true)
	logger.InfoCF("web", "Web channel started - routes registered on shared HTTP server", map[string]any{
		"routes": []string{"/api/chat", "/api/health"},
	})
	return nil
}

func (c *WebChannel) Stop(ctx context.Context) error {
	c.SetRunning(false)
	return nil
}

// WebhookPath returns the base path for web channel routes.
// This implements the WebhookHandler interface so the manager can register us.
func (c *WebChannel) WebhookPath() string {
	return "/api/"
}

// ServeHTTP handles HTTP requests for the web channel.
// Routes: POST /api/chat, GET /api/health
func (c *WebChannel) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch r.URL.Path {
	case "/api/chat":
		c.handleChat(w, r)
	case "/api/health":
		c.handleHealth(w, r)
	default:
		http.NotFound(w, r)
	}
}

// Send is called by the channel manager when the agent has a response for this channel.
// It wakes up the pending HTTP handler waiting for the given chat_id.
func (c *WebChannel) Send(_ context.Context, msg bus.OutboundMessage) error {
	c.pendingMu.Lock()
	ch, exists := c.pending[msg.ChatID]
	c.pendingMu.Unlock()

	if exists {
		select {
		case ch <- msg.Content:
		default:
			// Handler already timed out; discard
		}
	}

	return nil
}

func (c *WebChannel) setCORSHeaders(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
}

func (c *WebChannel) handleHealth(w http.ResponseWriter, r *http.Request) {
	c.setCORSHeaders(w)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (c *WebChannel) handleChat(w http.ResponseWriter, r *http.Request) {
	c.setCORSHeaders(w)

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req webChatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON body", http.StatusBadRequest)
		return
	}

	if req.Message == "" {
		http.Error(w, "message field is required", http.StatusBadRequest)
		return
	}

	if req.ChatID == "" {
		req.ChatID = "web-default"
	}

	// Register a pending response channel keyed to this chat_id.
	respCh := make(chan string, 1)
	c.pendingMu.Lock()
	c.pending[req.ChatID] = respCh
	c.pendingMu.Unlock()

	defer func() {
		c.pendingMu.Lock()
		delete(c.pending, req.ChatID)
		c.pendingMu.Unlock()
	}()

	// Publish the inbound message to the agent via the message bus.
	c.HandleMessage(r.Context(), bus.Peer{}, "", "web-user", req.ChatID, req.Message, nil, nil)

	// Wait for the agent to respond, with a 120-second timeout.
	ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
	defer cancel()

	w.Header().Set("Content-Type", "application/json")

	select {
	case response := <-respCh:
		_ = json.NewEncoder(w).Encode(webChatResponse{
			Success:  true,
			Response: response,
			ChatID:   req.ChatID,
		})
	case <-ctx.Done():
		w.WriteHeader(http.StatusGatewayTimeout)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "Request timed out waiting for agent response"})
	}
}

func init() {
	RegisterFactory("web", func(cfg *config.Config, b *bus.MessageBus) (Channel, error) {
		return NewWebChannel(cfg.Channels.Web, b)
	})
}
