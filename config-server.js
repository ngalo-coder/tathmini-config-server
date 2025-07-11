const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const { generateWorkflow } = require('./workflow-generator');

const app = express();
// Railway provides PORT environment variable
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// File to store projects
const PROJECTS_FILE = path.join(__dirname, 'projects.json');

// Initialize projects file if it doesn't exist
async function initializeProjects() {
    try {
        await fs.access(PROJECTS_FILE);
    } catch (error) {
        await fs.writeFile(PROJECTS_FILE, JSON.stringify([]));
        console.log('Created new projects file');
    }
}

// Load projects from file
async function loadProjects() {
    try {
        const data = await fs.readFile(PROJECTS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error loading projects:', error);
        return [];
    }
}

// Save projects to file
async function saveProjects(projects) {
    await fs.writeFile(PROJECTS_FILE, JSON.stringify(projects, null, 2));
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

        // Try to fetch form details
        const formResponse = await fetch(
            `${url}/v1/projects/${projectId}/forms/${formId}`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            }
        );

        if (!formResponse.ok) {
            throw new Error('Could not access form');
        }

        // Get submission count
        const submissionsResponse = await fetch(
            `${url}/v1/projects/${projectId}/forms/${formId}/submissions`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            }
        );

        let submissionCount = 0;
        if (submissionsResponse.ok) {
            const submissions = await submissionsResponse.json();
            submissionCount = submissions.length;
        }

        res.json({ 
            success: true, 
            message: 'Connection successful',
            submissionCount 
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
    const projects = await loadProjects();
    res.json(projects);
});

// Create new project
app.post('/api/projects', async (req, res) => {
    try {
        const projects = await loadProjects();
        const newProject = {
            id: Date.now().toString(),
            ...req.body,
            createdAt: new Date().toISOString()
        };
        
        projects.push(newProject);
        await saveProjects(projects);
        
        res.status(201).json(newProject);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update project
app.patch('/api/projects/:id', async (req, res) => {
    try {
        const projects = await loadProjects();
        const index = projects.findIndex(p => p.id === req.params.id);
        
        if (index === -1) {
            return res.status(404).json({ error: 'Project not found' });
        }
        
        projects[index] = { ...projects[index], ...req.body };
        await saveProjects(projects);
        
        res.json(projects[index]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Generate workflow for project
app.get('/api/projects/:id/workflow', async (req, res) => {
    try {
        const projects = await loadProjects();
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

// Health check endpoint for Railway
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Initialize and start server
async function start() {
    await initializeProjects();
    
    // Use 0.0.0.0 to bind to all network interfaces (required for Railway)
    app.listen(PORT, '0.0.0.0', () => {
        console.log('🚀 TathminiAI Configuration Server Started!');
        console.log(`📡 Server running on port ${PORT}`);
        console.log(`🌐 Railway URL: https://tathmini-config-server-production.up.railway.app`);
        console.log(`💾 Projects storage: ${PROJECTS_FILE}`);
        loadProjects().then(projects => {
            console.log(`📋 Current projects: ${projects.length}`);
        });
    });
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down gracefully...');
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('SIGINT received, shutting down gracefully...');
    process.exit(0);
});

start().catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
});