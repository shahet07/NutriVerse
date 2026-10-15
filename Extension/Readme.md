# NutriSense AI — Extension

---

## Short Description
Indian food nutrition intelligence. Look up any dish, classify food images, and get detailed macro & micronutrient breakdowns.

---

## Detailed Description

NutriSense AI is a nutrition assistant for Indian cuisine. It lets you instantly look up the nutritional content of any Indian dish — by typing the name, uploading a photo, or right-clicking text or images on any webpage.

**What it does:**
- **Text lookup** — Type any Indian dish (Dal Makhani, Chole Bhature, Masala Dosa…) and instantly get a full macro and micronutrient breakdown.
- **Image classification** — Upload a food photo and the AI identifies the dish and returns its nutrition data. Powered by a ConvNeXt-Small model trained on 239 Indian food classes.
- **Right-click lookup** — Select any dish name on a webpage, or right-click a food image, and choose "NutriSense: Look up" from the context menu. A results panel appears on the page without any navigation.
- **Dish comparison** — Query "Biryani vs Pulao" to get a side-by-side nutritional comparison.
- **Secure account** — Sign in with Google or email/password. Your session is stored locally on your device only.

**What it does NOT do:**
- It does not read, monitor, or transmit any page content.
- It does not track your browsing history.
- The content script is injected only when you explicitly trigger a right-click action — it is never loaded passively.

---

## Privacy Policy URL
https://kashyapk07.github.io/NutriSense-AI/Extension/privacy-policy.html

---

## Category
Lifestyle

## Language
English

---

## Single-Purpose Description
NutriSense AI has one purpose: providing nutritional information for Indian food dishes. Every permission requested — context menus, scripting, storage, identity, and host access — exists solely to deliver that nutrition lookup experience to the user wherever they are browsing.

---

## Permission Justifications

### `contextMenus`
This permission powers the primary on-page workflow. When a user selects any dish name on a recipe blog, food delivery app (Zomato, Swiggy), or social media post, or right-clicks a food image, they can choose "NutriSense: Look up" or "NutriSense: Classify food image" from the context menu. The result is shown in a panel directly on the page so the user never has to leave the site. Without this permission, users would have to manually copy text and switch to the popup — which defeats the purpose of the extension.

### `storage`
Used for two things only:
1. `chrome.storage.local` — stores the user's Firebase access token and refresh token so they remain signed in across browser restarts. Tokens never leave the device.
2. `chrome.storage.sync` — stores the optional custom API URL set in the extension's Options page.
No browsing data, page content, or personally identifiable information beyond what the user explicitly submits is ever stored.

### `scripting`
Used to inject the nutrition results panel into the current tab **only when the user explicitly triggers a context menu action**. The panel is built with Shadow DOM so its styles are fully isolated from the host page. The content script is not declared as a static content script in the manifest — it is injected dynamically, on demand, per user action. No script is ever injected passively or without user intent.

### `identity`
Used exclusively to launch Google's OAuth 2.0 sign-in flow via `chrome.identity.launchWebAuthFlow`. Only `openid email profile` scopes are requested. No Google Drive, Gmail, Calendar, or any other Google service is accessed. This is the standard Chrome extension method for Google sign-in without storing a client secret.

### `host_permissions: <all_urls>`
This is required because the context menu features must work on any website the user visits. Indian food appears on recipe blogs, restaurant sites, food delivery apps (Zomato, Swiggy, EatSure), social media (Instagram, YouTube), and health trackers — there is no predictable fixed set of domains. `<all_urls>` is the only way to support right-click lookup universally.

**Critically, this permission is not used for passive data collection.** The extension:
- Does not inject any script on page load.
- Does not read or transmit any page content.
- Only injects a results panel when the user explicitly selects a context menu item.
- The injected panel displays data returned from our API — it does not send any page data to our servers.

The sole reason for `<all_urls>` is to enable the context menu to function on any site, which is a standard and documented use case for this permission level.

---

## Data Use Disclosure

| Data type | Collected | Used for | Shared with third parties |
|-----------|-----------|----------|--------------------------|
| Email address and display name | Yes | Firebase Authentication (sign-in only) | No |
| Authentication tokens | Yes | Local session persistence on device only | No |
| Like / dislike interactions | Yes | Personalising recommendations | No |
| Food text queries | Transmitted, not stored | Returning nutrition results | No |
| Food images | Transmitted, processed in-memory, not stored | Returning classification results | No |
| Browsing history | No | — | — |
| Page content | No | — | — |
| Financial information | No | — | — |

No data is sold, rented, or used for advertising.

---

## Screenshots needed (1280×800 or 640×400)
1. Popup — text lookup result (e.g. Dal Makhani with nutrition breakdown)
2. Popup — image upload and classification result
3. Popup — sign-in screen (Google + email options)
4. Right-click context menu on a food image showing the NutriSense option
5. On-page results panel injected after a context menu action
