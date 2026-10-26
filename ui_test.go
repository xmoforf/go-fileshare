package main

import (
	"strings"
	"testing"
)

func TestShareUIContract(t *testing.T) {
	for _, s := range []string{`id="loginDialog"`, `id="shareDialog"`, `id="sharesDialog"`, `id="shareCurrent"`, `/api/list`, `/api/shares`, `/api/login`, `X-Requested-With`, `encodeURIComponent(item.name)`, `function renderVisible()`, `function applyFilterAndSort()`} {
		if !strings.Contains(string(ui), s) {
			t.Errorf("UI missing %s", s)
		}
	}
	// Fanboy's Social Blocking List hides the generic .share-btn class.
	if strings.Contains(string(ui), "copy-btn share-btn") || !strings.Contains(string(ui), "copy-btn file-link-action") {
		t.Error("file action must not match the known social-sharing cosmetic filter")
	}
	if strings.Contains(string(ui), "fetch('_api/'") {
		t.Error("legacy API remains")
	}
}
