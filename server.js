const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// In-memory storage
let projects = [];

// Serve static files
app.use(express.static('public'));

// Health check
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Test ODK connection
app.post('/api/test-connection', async (req, res) => {
    const { url, email, password, projectId, formId } = req.body;
    
    console.log('Testing connection to:', url);
    
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
app.post('/api/projects', (req, res) => {
    const newProject = {
        id: Date.now().toString(),
        ...req.body,
        createdAt: new Date().toISOString()
    };
    
    projects.push(newProject);
    console.log('Project created:', newProject.name);
    res.status(201).json(newProject);
});

// Update project
app.patch('/api/projects/:id', (req, res) => {
    const index = projects.findIndex(p => p.id === req.params.id);
    
    if (index === -1) {
        return res.status(404).json({ error: 'Project not found' });
    }
    
    projects[index] = { ...projects[index], ...req.body };
    res.json(projects[index]);
});

// Delete project
app.delete('/api/projects/:id', (req, res) => {
    const initialLength = projects.length;
    projects = projects.filter(p => p.id !== req.params.id);
    
    if (projects.length === initialLength) {
        return res.status(404).json({ error: 'Project not found' });
    }
    
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
                        interval: [{ minutes: project.updateFrequency || 15 }]
                    }
                },
                id: "schedule-trigger",
                name: "Schedule Trigger",
                type: "n8n-nodes-base.scheduleTrigger",
                position: [250, 300]
            },
            {
                parameters: {
                    url: `${project.odkConnection.url}/v1/projects/${project.odkConnection.projectId}/forms/${project.odkConnection.formId}/submissions`,
                    authentication: "genericCredentialType",
                    genericAuthType: "httpBasicAuth",
                    responseFormat: "json"
                },
                id: "fetch-odk-data",
                name: "Fetch ODK Data",
                type: "n8n-nodes-base.httpRequest",
                position: [450, 300]
            }
        ],
        connections: {
            "Schedule Trigger": {
                "main": [[{ "node": "Fetch ODK Data", "type": "main", "index": 0 }]]
            }
        }
    };
    
    res.json(workflow);
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ TathminiAI Config Server running on port ${PORT}`);
    console.log(`📍 Local: http://localhost:${PORT}`);
    console.log(`🌐 Network: http://0.0.0.0:${PORT}`);
});

// Handle shutdown gracefully
process.on('SIGTERM', () => {
    console.log('SIGTERM received, keeping server alive...');
    // Don't exit - let Railway handle it
});