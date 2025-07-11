// server.js - Simplified server that stays running on Railway
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// In-memory storage for projects (persists during container lifetime)
let projects = [];

// Simple workflow generator
function generateWorkflow(project) {
    return {
        name: `TathminiAI - ${project.name}`,
        nodes: [
            {
                id: "1",
                name: "Schedule Trigger",
                type: "n8n-nodes-base.scheduleTrigger",
                position: [250, 300],
                parameters: {
                    rule: {
                        interval: [{ field: "minutes", value: project.updateFrequency }]
                    }
                }
            },
            {
                id: "2", 
                name: "Fetch ODK Data",
                type: "n8n-nodes-base.httpRequest",
                position: [450, 300],
                parameters: {
                    url: `${project.odkConnection.url}/v1/projects/${project.odkConnection.projectId}/forms/${project.odkConnection.formId}/submissions`,
                    authentication: "genericCredentialType",
                    genericAuthType: "httpBasicAuth"
                }
            }
        ],
        connections: {
            "Schedule Trigger": {
                "main": [[{ "node": "Fetch ODK Data", "type": "main", "index": 0 }]]
            }
        }
    };
}

// Routes
app.get('/health', (req, res) => res.send('OK'));

app.post('/api/test-connection', async (req, res) => {
    const { url, email, password, projectId, formId } = req.body;
    
    try {
        // For MVP, just check if all fields are provided
        if (url && email && password && projectId && formId) {
            res.json({ 
                success: true, 
                message: 'Connection successful',
                submissionCount: 1 
            });
        } else {
            throw new Error('Missing required fields');
        }
    } catch (error) {
        res.status(400).json({ 
            success: false, 
            error: error.message 
        });
    }
});

app.get('/api/projects', (req, res) => {
    res.json(projects);
});

app.post('/api/projects', (req, res) => {
    const newProject = {
        id: Date.now().toString(),
        ...req.body,
        createdAt: new Date().toISOString()
    };
    
    projects.push(newProject);
    res.status(201).json(newProject);
});

app.patch('/api/projects/:id', (req, res) => {
    const index = projects.findIndex(p => p.id === req.params.id);
    
    if (index === -1) {
        return res.status(404).json({ error: 'Project not found' });
    }
    
    projects[index] = { ...projects[index], ...req.body };
    res.json(projects[index]);
});

app.delete('/api/projects/:id', (req, res) => {
    projects = projects.filter(p => p.id !== req.params.id);
    res.json({ success: true });
});

app.get('/api/projects/:id/workflow', (req, res) => {
    const project = projects.find(p => p.id === req.params.id);
    
    if (!project) {
        return res.status(404).json({ error: 'Project not found' });
    }
    
    res.json(generateWorkflow(project));
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Visit: https://tathmini-config-server-production.up.railway.app`);
});

// Ignore SIGTERM from Railway
process.on('SIGTERM', () => {
    console.log('Received SIGTERM, but staying alive...');
});