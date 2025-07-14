// server.js - Complete TathminiAI Platform Server
const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// In-memory storage for projects
let projects = [];
const PROJECTS_FILE = path.join(__dirname, 'projects.json');

// Initialize projects from file
async function initializeProjects() {
    try {
        await fs.access(PROJECTS_FILE);
        const data = await fs.readFile(PROJECTS_FILE, 'utf8');
        projects = JSON.parse(data);
        console.log(`Loaded ${projects.length} projects from file`);
    } catch (error) {
        console.log('No projects file found, starting with empty array');
        projects = [];
        await saveProjects();
    }
}

// Save projects to file
async function saveProjects() {
    try {
        await fs.writeFile(PROJECTS_FILE, JSON.stringify(projects, null, 2));
    } catch (error) {
        console.error('Error saving projects:', error);
    }
}

// Serve the complete unified application
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve static files
app.use(express.static('public'));

// API Routes

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        service: 'TathminiAI Platform',
        version: '2.0.0',
        projectsCount: projects.length
    });
});

// Test ODK connection
app.post('/api/test-connection', async (req, res) => {
    const { url, email, password, projectId, formId } = req.body;
    
    console.log('Testing ODK connection to:', url);
    
    try {
        // Authenticate with ODK
        const authResponse = await fetch(`${url}/v1/sessions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email, password })
        });

        if (!authResponse.ok) {
            throw new Error('Authentication failed');
        }

        const { token } = await authResponse.json();

        // Get forms to verify connection
        const formsResponse = await fetch(
            `${url}/v1/projects/${projectId}/forms`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            }
        );

        if (!formsResponse.ok) {
            throw new Error('Could not access forms');
        }

        const forms = await formsResponse.json();
        
        res.json({ 
            success: true, 
            message: `Connection successful! Found ${forms.length} forms.`
        });
    } catch (error) {
        console.error('Connection test failed:', error.message);
        res.status(400).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Get all projects
app.get('/api/projects', (req, res) => {
    res.json(projects);
});

// Create new project
app.post('/api/projects', async (req, res) => {
    const newProject = {
        id: Date.now().toString(),
        ...req.body,
        createdAt: new Date().toISOString()
    };
    
    projects.push(newProject);
    await saveProjects();
    
    console.log('Project created:', newProject.name);
    res.status(201).json(newProject);
});

// Update project
app.patch('/api/projects/:id', async (req, res) => {
    const index = projects.findIndex(p => p.id === req.params.id);
    
    if (index === -1) {
        return res.status(404).json({ error: 'Project not found' });
    }
    
    projects[index] = { ...projects[index], ...req.body };
    await saveProjects();
    
    res.json(projects[index]);
});

// Delete project
app.delete('/api/projects/:id', async (req, res) => {
    const initialLength = projects.length;
    projects = projects.filter(p => p.id !== req.params.id);
    
    if (projects.length === initialLength) {
        return res.status(404).json({ error: 'Project not found' });
    }
    
    await saveProjects();
    res.json({ success: true });
});

// Generate n8n workflow
app.get('/api/projects/:id/workflow', (req, res) => {
    const project = projects.find(p => p.id === req.params.id);
    
    if (!project) {
        return res.status(404).json({ error: 'Project not found' });
    }
    
    const workflow = {
        name: `TathminiAI - ${project.name}`,
        nodes: [
            {
                parameters: {
                    rule: {
                        interval: [{ 
                            field: "minutes",
                            minutesInterval: project.updateFrequency || 15 
                        }]
                    }
                },
                id: "schedule-trigger",
                name: "Schedule Trigger",
                type: "n8n-nodes-base.scheduleTrigger",
                position: [250, 300],
                typeVersion: 1.2
            },
            {
                parameters: {
                    url: `${project.odkConnection.url}/v1/projects/${project.odkConnection.projectId}/forms/${project.odkConnection.formId}/submissions`,
                    authentication: "genericCredentialType",
                    genericAuthType: "httpBasicAuth",
                    sendHeaders: true,
                    headerParameters: {
                        parameters: [{
                            name: "Content-Type",
                            value: "application/json"
                        }]
                    },
                    options: {}
                },
                id: "fetch-odk-data",
                name: "Fetch ODK Data",
                type: "n8n-nodes-base.httpRequest",
                position: [450, 300],
                typeVersion: 4.2,
                credentials: {
                    httpBasicAuth: {
                        id: "YOUR_CREDENTIAL_ID",
                        name: "ODK Credentials"
                    }
                }
            }
        ],
        connections: {
            "Schedule Trigger": {
                "main": [[{ 
                    "node": "Fetch ODK Data", 
                    "type": "main", 
                    "index": 0 
                }]]
            }
        }
    };
    
    res.json(workflow);
});

// Proxy for Airtable data (to avoid CORS issues)
app.get('/api/airtable/summary', async (req, res) => {
    const airtableKey = req.headers['x-airtable-key'];
    const baseId = req.headers['x-airtable-base'];
    
    if (!airtableKey || !baseId) {
        return res.status(400).json({ error: 'Missing Airtable credentials' });
    }
    
    try {
        const response = await fetch(
            `https://api.airtable.com/v0/${baseId}/Summary%20Stats?maxRecords=10&sort%5B0%5D%5Bfield%5D=Processed%20At&sort%5B0%5D%5Bdirection%5D=desc`,
            {
                headers: {
                    'Authorization': `Bearer ${airtableKey}`
                }
            }
        );
        
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Airtable proxy error:', error);
        res.status(500).json({ error: 'Failed to fetch Airtable data' });
    }
});

app.get('/api/airtable/ai-analysis', async (req, res) => {
    const airtableKey = req.headers['x-airtable-key'];
    const baseId = req.headers['x-airtable-base'];
    
    if (!airtableKey || !baseId) {
        return res.status(400).json({ error: 'Missing Airtable credentials' });
    }
    
    try {
        const response = await fetch(
            `https://api.airtable.com/v0/${baseId}/AI%20Analyses?maxRecords=1&sort%5B0%5D%5Bfield%5D=Timestamp&sort%5B0%5D%5Bdirection%5D=desc`,
            {
                headers: {
                    'Authorization': `Bearer ${airtableKey}`
                }
            }
        );
        
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Airtable proxy error:', error);
        res.status(500).json({ error: 'Failed to fetch Airtable data' });
    }
});

// Dashboard webhook endpoint (for n8n updates)
app.post('/api/webhook/dashboard-update', (req, res) => {
    const { runId, stats, insights, alerts } = req.body;
    
    console.log(`Dashboard update received for run: ${runId}`);
    
    // In a production app, you might store this in a database
    // or push it to connected clients via WebSocket
    
    res.json({ success: true, message: 'Dashboard update received' });
});

// Start server
async function start() {
    await initializeProjects();
    
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`✅ TathminiAI Platform running on port ${PORT}`);
        console.log(`🌐 Access at: https://tathmini-config-server-production-5a6e.up.railway.app`);
        console.log(`📊 Dashboard, Projects, Reports - All in one place!`);
    });
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, keeping server alive...');
});

start();