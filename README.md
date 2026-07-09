# Bella Customers Orders

React app for browsing Bella Boutique customers, their orders, purchases, requested items, shipments, deliveries, package tasks, delivery payment status, and receipts.

The app uses the same Firebase Web config and shared Firestore collections as the Bella Boutique Management app. It subscribes with anonymous auth. The app writes only customer profile edits and explicit package task delivery payment updates when staff save those forms.

## Setup

Copy the Firebase values from the reference app into `.env.local` using the same `REACT_APP_FIREBASE_*` names, then run:

```sh
npm install
npm run build
npm run dev
```

## Shared Firestore collections

- `customers`
- `orders`
- `purchases`
- `requestedItems`
- `shipments`
- `deliveries`
- `packageTasks`
- `packageScanLogs`

