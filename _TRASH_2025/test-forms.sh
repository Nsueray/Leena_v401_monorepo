#!/bin/bash

echo "================================"
echo "Forms Module Complete Test"
echo "================================"

API_URL="http://localhost:3000/api"

# 1. Login
echo -e "\n1. Logging in..."
LOGIN_RESPONSE=$(curl -s -X POST $API_URL/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"123456"}')

TOKEN=$(echo $LOGIN_RESPONSE | grep -o '"token":"[^"]*' | sed 's/"token":"//')

if [ -z "$TOKEN" ]; then
    echo "❌ Login failed"
    echo "Response: $LOGIN_RESPONSE"
    exit 1
fi

echo "✅ Login successful"
echo "Token: ${TOKEN:0:30}..."

# 2. List all forms
echo -e "\n2. Listing all forms..."
FORMS_RESPONSE=$(curl -s -X GET $API_URL/forms \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json")

echo "Response: $FORMS_RESPONSE"

# 3. Create a new form
echo -e "\n3. Creating a new form..."
CREATE_RESPONSE=$(curl -s -X POST $API_URL/forms \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Expo Registration Form",
    "description": "Main registration form for expo visitors",
    "expo_id": 15,
    "fields": [
      {
        "name": "full_name",
        "label": "Full Name",
        "type": "text",
        "required": true,
        "placeholder": "Enter your full name"
      },
      {
        "name": "email",
        "label": "Email",
        "type": "email",
        "required": true,
        "placeholder": "your@email.com"
      },
      {
        "name": "phone",
        "label": "Phone",
        "type": "tel",
        "required": false,
        "placeholder": "+90 XXX XXX XX XX"
      },
      {
        "name": "company",
        "label": "Company",
        "type": "text",
        "required": false,
        "placeholder": "Your company"
      },
      {
        "name": "visitor_type",
        "label": "Visitor Type",
        "type": "select",
        "required": true,
        "options": ["Regular", "VIP", "Press", "Exhibitor"]
      }
    ],
    "is_active": true
  }')

echo "Response: $CREATE_RESPONSE"

# Extract form ID if created successfully
FORM_ID=$(echo $CREATE_RESPONSE | grep -o '"id":[0-9]*' | head -1 | sed 's/"id"://')

if [ ! -z "$FORM_ID" ]; then
    echo "✅ Form created with ID: $FORM_ID"
    
    # 4. Get single form
    echo -e "\n4. Getting form details..."
    FORM_DETAIL=$(curl -s -X GET $API_URL/forms/$FORM_ID \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json")
    
    echo "Form details received"
    
    # 5. Get form statistics
    echo -e "\n5. Getting form statistics..."
    STATS_RESPONSE=$(curl -s -X GET $API_URL/forms/$FORM_ID/stats \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json")
    
    echo "Stats: $STATS_RESPONSE"
else
    echo "⚠️ Form creation might have failed"
fi

# 6. Get forms for expo
echo -e "\n6. Getting forms for Expo ID 15..."
EXPO_FORMS=$(curl -s -X GET $API_URL/forms/expo/15 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json")

echo "Expo forms received"

echo -e "\n================================"
echo "Test completed!"
echo "================================"
echo "Now you can:"
echo "1. Open browser and go to form-list.html"
echo "2. Create new forms using the Form Builder"
echo "3. View and manage your forms"
