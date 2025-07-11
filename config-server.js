const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// In-memory storage for projects
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
                        interval: [{ field: "minutes", value: project.updateFrequency || 15 }]
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
                    genericAuthType: "httpBasicAuth",
                    sendHeaders: true,
                    headerParameters: {
                        parameters: [
                            {
                                name: "Authorization",
                                value: "Bearer {{$credentials.token}}"
                            }
                        ]
                    }
                }
            },
            {
                id: "3",
                name: "Process Data",
                type: "n8n-nodes-base.code",
                position: [650, 300],
                parameters: {
                    language: "javascript",
                    code: `// Process ODK submissions\nconst submissions = items[0].json;\nreturn submissions.map(sub => ({\n  json: {\n    submissionId: sub.instanceId,\n    data: sub.value,\n    submittedAt: sub.createdAt\n  }\n}));`
                }
            }
        ],
        connections: {
            "Schedule Trigger": {
                "main": [[{ "node": "Fetch ODK Data", "type": "main", "index": 0 }]]
            },
            "Fetch ODK Data": {
                "main": [[{ "node": "Process Data", "type": "main", "index": 0 }]]
            }
        }
    };
}

// API Routes

// Test ODK connection
app.post('/api/test-connection', async (req, res) => {
    const { url, email, password, projectId, formId } = req.body;
    
    try {
        // Test connection to ODK Central
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

        // Try to fetch project forms to verify connection
        const formsResponse = await fetch(
            `${url}/v1/projects/${projectId}/forms`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            }
        );

        if (!formsResponse.ok) {
            throw new Error('Could not access project forms');
        }

        const forms = await formsResponse.json();
        
        res.json({ 
            success: true, 
            message: `Connection successful! Found ${forms.length} forms.`,
            formsCount: forms.length
        });
    } catch (error) {
        res.status(400).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Get all projects
app.get('/api/projects', async (req, res) => {
    res.json(projects);
});

// Create new project
app.post('/api/projects', async (req, res) => {
    try {
        const newProject = {
            id: Date.now().toString(),
            ...req.body,
            createdAt: new Date().toISOString()
        };
        
        projects.push(newProject);
        res.status(201).json(newProject);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update project
app.patch('/api/projects/:id', async (req, res) => {
    try {
        const index = projects.findIndex(p => p.id === req.params.id);
        
        if (index === -1) {
            return res.status(404).json({ error: 'Project not found' });
        }
        
        projects[index] = { ...projects[index], ...req.body };
        res.json(projects[index]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete project
app.delete('/api/projects/:id', async (req, res) => {
    try {
        const initialLength = projects.length;
        projects = projects.filter(p => p.id !== req.params.id);
        
        if (projects.length === initialLength) {
            return res.status(404).json({ error: 'Project not found' });
        }
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Generate workflow for project
app.get('/api/projects/:id/workflow', async (req, res) => {
    try {
        const project = projects.find(p => p.id === req.params.id);
        
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }
        
        const workflow = generateWorkflow(project);
        res.json(workflow);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.send('OK');
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`TathminiAI Config Server running on port ${PORT}`);
    console.log(`Access at: https://tathmini-config-server-production.up.railway.app`);
});