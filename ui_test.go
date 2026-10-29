package main

import (
	"strings"
	"testing"
)

func TestAccessibleUIContract(t *testing.T) {
	for _, s := range []string{
		`<button type="button" class="col-name" data-sort="name">`,
		`<button type="button" class="col-size" data-sort="size">`,
		`<button type="button" class="col-date" data-sort="date">`,
		`id="viewport" role="list" aria-label="Files"`,
		`aria-posinset`, `aria-setsize`,
		`id="themeDialog" aria-labelledby="themeTitle"`,
		`id="themeSearch"`, `id="themeSelect"`,
		`id="themeApply"`, `id="themeReset"`,
		`id="themeToggle" aria-label="Choose theme" title="Choose theme" aria-haspopup="dialog"`,
		`aria-hidden="true" focusable="false"`, `Use system default</button>`,
		`id="themeResults" role="status"`,
		`<option value="3600">1 hour</option>`,
		`<option value="86400">1 day</option>`,
		`<option value="604800" selected>7 days</option>`,
		`<option value="2592000">30 days</option>`,
		`<option value="0">Never</option>`,
	} {
		if !strings.Contains(string(ui), s) {
			t.Errorf("UI missing native control: %s", s)
		}
	}
	for _, s := range []string{`customHours`, `id="pagination"`, `customSeconds`, `customLabel`, `value="custom"`} {
		if strings.Contains(string(ui), s) {
			t.Errorf("UI retains obsolete behavior: %s", s)
		}
	}
}

func TestShareUIContract(t *testing.T) {
	for _, s := range []string{`id="loginDialog"`, `id="shareDialog"`, `id="sharesDialog"`, `id="shareCurrent"`, `/api/list`, `/api/shares`, `/api/login`, `X-Requested-With`, `encodeURIComponent(item.name)`} {
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
